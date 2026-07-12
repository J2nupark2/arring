import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { fetchCharacterInfo } from "@/lib/aion2-api";

const CHARACTER_REFRESH_COOLDOWN_MS = 60_000;

type CharacterRow = {
  id: string;
  user_id: string;
  character_id: string;
  server_id: number;
  synced_at: string;
  is_primary: boolean;
};

function remainingCooldownSeconds(syncedAt?: string | null) {
  if (!syncedAt) return 0;
  const remaining =
    CHARACTER_REFRESH_COOLDOWN_MS - (Date.now() - new Date(syncedAt).getTime());
  return Math.max(0, Math.ceil(remaining / 1000));
}

function pickList(source: unknown, keys: string[]) {
  if (!source || typeof source !== "object") return [];
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
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

  if (!user || user.is_anonymous) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: "캐릭터 ID가 필요합니다." }, { status: 400 });
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false } },
  );

  const { data: target, error: targetError } = await admin
    .from("aion2_characters")
    .select("id, user_id, character_id, server_id, synced_at, is_primary")
    .eq("id", body.id)
    .single<CharacterRow>();

  if (targetError || !target) {
    return NextResponse.json({ error: "캐릭터를 찾을 수 없습니다." }, { status: 404 });
  }

  const { data: latest } = await admin
    .from("aion2_characters")
    .select("synced_at")
    .eq("character_id", target.character_id)
    .eq("server_id", target.server_id)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ synced_at: string }>();

  const retryAfterSeconds = remainingCooldownSeconds(latest?.synced_at);
  if (retryAfterSeconds > 0) {
    return NextResponse.json(
      {
        error: `이 캐릭터는 ${retryAfterSeconds}초 후 다시 갱신할 수 있습니다.`,
        retryAfterSeconds,
        lastSyncedAt: latest?.synced_at,
      },
      { status: 429 },
    );
  }

  let profile;
  try {
    profile = await fetchCharacterInfo(target.character_id, target.server_id);
  } catch {
    return NextResponse.json(
      { error: "공식 정보실에서 캐릭터 정보를 가져오지 못했습니다." },
      { status: 502 },
    );
  }

  const syncedAt = new Date().toISOString();
  const rawProfile = profile as unknown;

  const { data: matchingRows } = await admin
    .from("aion2_characters")
    .select("id, user_id, character_id, server_id, synced_at, is_primary")
    .eq("character_id", profile.characterId)
    .eq("server_id", profile.serverId)
    .limit(500);

  const { error: updateError } = await admin
    .from("aion2_characters")
    .update({
      character_name: profile.characterName,
      server_name: profile.serverName,
      class_name: profile.className,
      character_level: profile.characterLevel,
      combat_power: profile.combatPower,
      equipment: pickList(rawProfile, ["equipment", "equipments", "items", "itemList"]),
      skills: pickList(rawProfile, ["skills", "skillList"]),
      stigmas: pickList(rawProfile, ["stigmas", "stigmaList"]),
      detail_data: profile.detailData,
      synced_at: syncedAt,
    } as unknown as never)
    .eq("character_id", profile.characterId)
    .eq("server_id", profile.serverId);

  if (updateError) {
    return NextResponse.json(
      { error: "캐릭터 갱신 저장에 실패했습니다: " + updateError.message },
      { status: 500 },
    );
  }

  const primaryRows = (matchingRows ?? []).filter((row) => row.is_primary);
  await Promise.all(
    primaryRows.map((row) =>
      admin
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
        .eq("id", row.user_id),
    ),
  );

  return NextResponse.json({
    refreshedAt: syncedAt,
    updatedRows: matchingRows?.length ?? 0,
    character: {
      id: target.id,
      name: profile.characterName,
      server: profile.serverName,
      className: profile.className,
      level: profile.characterLevel,
      combatPower: profile.combatPower,
    },
  });
}
