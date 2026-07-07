import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { fetchCharacterInfo } from "@/lib/aion2-api";

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

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false } },
  );

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

  return NextResponse.json({
    character: {
      name: profile.characterName,
      server: profile.serverName,
      className: profile.className,
      level: profile.characterLevel,
      combatPower: profile.combatPower,
    },
  });
}
