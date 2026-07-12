import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { fetchCharacterInfo, type Aion2CharacterProfile } from "@/lib/aion2-api";

const CHARACTER_SYNC_COOLDOWN_MS = 60_000;

type CachedCharacterRow = {
  character_id: string;
  character_name: string;
  server_id: number;
  server_name: string;
  class_name: string;
  character_level: number;
  combat_power: number;
  equipment: unknown[] | null;
  skills: unknown[] | null;
  stigmas: unknown[] | null;
  detail_data: Aion2CharacterProfile["detailData"] | null;
  synced_at: string;
};

function pickList(source: unknown, keys: string[]) {
  if (!source || typeof source !== "object") return [];
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function isFreshSync(syncedAt?: string | null) {
  if (!syncedAt) return false;
  return Date.now() - new Date(syncedAt).getTime() < CHARACTER_SYNC_COOLDOWN_MS;
}

function profileFromCachedRow(row: CachedCharacterRow): Aion2CharacterProfile {
  return {
    characterId: row.character_id,
    characterName: row.character_name,
    serverId: row.server_id,
    serverName: row.server_name,
    className: row.class_name,
    characterLevel: row.character_level,
    combatPower: row.combat_power,
    equipment: Array.isArray(row.equipment) ? row.equipment : [],
    skills: Array.isArray(row.skills) ? row.skills : [],
    stigmas: Array.isArray(row.stigmas) ? row.stigmas : [],
    detailData: row.detail_data ?? ({} as Aion2CharacterProfile["detailData"]),
  };
}

export async function POST(request: NextRequest) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json(
      { error: "서버에 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다." },
      { status: 500 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (user.is_anonymous) {
    return NextResponse.json(
      { error: "게스트는 캐릭터를 연동할 수 없습니다. 회원가입 후 이용해주세요." },
      { status: 403 },
    );
  }

  let body: { characterId?: string; serverId?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const characterId = body.characterId?.trim();
  const serverId = Number(body.serverId);
  if (!characterId || !Number.isInteger(serverId) || serverId <= 0) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false } },
  );

  const { data: cachedCharacter } = await admin
    .from("aion2_characters")
    .select(
      "character_id, character_name, server_id, server_name, class_name, character_level, combat_power, equipment, skills, stigmas, detail_data, synced_at",
    )
    .eq("character_id", characterId)
    .eq("server_id", serverId)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle<CachedCharacterRow>();

  let profile: Aion2CharacterProfile;
  let syncedAt = new Date().toISOString();
  let fromCache = false;

  if (cachedCharacter && isFreshSync(cachedCharacter.synced_at)) {
    profile = profileFromCachedRow(cachedCharacter);
    syncedAt = cachedCharacter.synced_at;
    fromCache = true;
  } else {
    try {
      profile = await fetchCharacterInfo(characterId, serverId);
    } catch {
      return NextResponse.json(
        { error: "공식 정보실에서 캐릭터 정보를 가져오지 못했습니다." },
        { status: 502 },
      );
    }
  }

  if (!profile.characterName || typeof profile.combatPower !== "number") {
    return NextResponse.json(
      { error: "캐릭터 정보를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const rawProfile = profile as unknown;

  const { data: existingCharacters } = await admin
    .from("aion2_characters")
    .select("id, character_id, server_id, is_primary")
    .eq("user_id", user.id)
    .limit(100);
  const shouldBePrimary = (existingCharacters ?? []).length === 0;
  const existingCharacter = (existingCharacters ?? []).find(
    (character) =>
      character.character_id === profile.characterId &&
      character.server_id === profile.serverId,
  ) as { is_primary?: boolean } | undefined;
  const isPrimary = shouldBePrimary || existingCharacter?.is_primary === true;

  if (shouldBePrimary) {
    await admin
      .from("aion2_characters")
      .update({ is_primary: false } as unknown as never)
      .eq("user_id", user.id);
  }

  const { data: characterRow, error: characterError } = await admin
    .from("aion2_characters")
    .upsert(
      {
        user_id: user.id,
        character_id: profile.characterId,
        character_name: profile.characterName,
        server_id: profile.serverId,
        server_name: profile.serverName,
        class_name: profile.className,
        character_level: profile.characterLevel,
        combat_power: profile.combatPower,
        equipment: pickList(rawProfile, ["equipment", "equipments", "items", "itemList"]),
        skills: pickList(rawProfile, ["skills", "skillList"]),
        stigmas: pickList(rawProfile, ["stigmas", "stigmaList"]),
        detail_data: profile.detailData,
        is_primary: isPrimary,
        synced_at: syncedAt,
      } as unknown as never,
      { onConflict: "user_id,character_id,server_id" },
    )
    .select("id")
    .single();

  if (characterError || !characterRow) {
    return NextResponse.json(
      { error: "캐릭터 저장에 실패했습니다: " + (characterError?.message ?? "") },
      { status: 500 },
    );
  }

  if (isPrimary) {
    const { error } = await admin
      .from("profiles")
      .update({
        nickname: profile.characterName,
        char_class: profile.className,
        combat_power: profile.combatPower,
        server: profile.serverName,
        aion2_character_id: profile.characterId,
        aion2_character_name: profile.characterName,
        aion2_server_id: profile.serverId,
        aion2_synced_at: syncedAt,
      })
      .eq("id", user.id);

    if (error) {
      return NextResponse.json(
        { error: "프로필 저장에 실패했습니다: " + error.message },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    character: {
      id: (characterRow as { id: string }).id,
      name: profile.characterName,
      server: profile.serverName,
      className: profile.className,
      level: profile.characterLevel,
      combatPower: profile.combatPower,
      fromCache,
    },
  });
}
