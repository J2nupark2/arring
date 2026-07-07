import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { fetchCharacterInfo } from "@/lib/aion2-api";

function pickList(source: unknown, keys: string[]) {
  if (!source || typeof source !== "object") return [];
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

// Links (or re-syncs) the caller's Arring profile to an official Aion2
// character. The client only tells us WHICH character; class and combat
// power always come from aion2.plaync.com fetched here, and are written
// with the service role — normal users have no UPDATE grant on those
// columns, so combat power can't be faked.
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

  let profile;
  try {
    profile = await fetchCharacterInfo(characterId, serverId);
  } catch {
    return NextResponse.json(
      { error: "공식 홈페이지에서 캐릭터 정보를 가져오지 못했습니다." },
      { status: 502 },
    );
  }

  if (!profile?.characterName || typeof profile.combatPower !== "number") {
    return NextResponse.json(
      { error: "캐릭터 정보를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  const rawProfile = profile as unknown;

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false } },
  );

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
        is_primary: isPrimary,
        synced_at: new Date().toISOString(),
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
        char_class: profile.className,
        combat_power: profile.combatPower,
        server: profile.serverName,
        aion2_character_id: profile.characterId,
        aion2_character_name: profile.characterName,
        aion2_server_id: profile.serverId,
        aion2_synced_at: new Date().toISOString(),
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
    },
  });
}
