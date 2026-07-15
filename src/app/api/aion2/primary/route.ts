import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rate-limit";

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

  const limited = await enforceRateLimit(request, {
    scope: "aion2-primary",
    identifier: user.id,
    limit: 20,
    windowSeconds: 60,
  });
  if (limited) return limited;

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: "캐릭터를 선택해주세요." }, { status: 400 });
  }

  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey,
    { auth: { persistSession: false } },
  );

  const { data: character, error: characterError } = await admin
    .from("aion2_characters")
    .select(
      "id, character_id, character_name, server_id, server_name, class_name, combat_power, synced_at",
    )
    .eq("id", body.id)
    .eq("user_id", user.id)
    .single();

  if (characterError || !character) {
    return NextResponse.json(
      { error: "내 캐릭터를 찾을 수 없습니다." },
      { status: 404 },
    );
  }

  await admin
    .from("aion2_characters")
    .update({ is_primary: false } as unknown as never)
    .eq("user_id", user.id);

  const { error: primaryError } = await admin
    .from("aion2_characters")
    .update({ is_primary: true } as unknown as never)
    .eq("id", body.id)
    .eq("user_id", user.id);

  if (primaryError) {
    return NextResponse.json(
      { error: "대표 캐릭터 설정에 실패했습니다: " + primaryError.message },
      { status: 500 },
    );
  }

  const selected = character as {
    character_id: string;
    character_name: string;
    server_id: number;
    server_name: string;
    class_name: string;
    combat_power: number;
    synced_at: string;
  };

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      char_class: selected.class_name,
      combat_power: selected.combat_power,
      server: selected.server_name,
      aion2_character_id: selected.character_id,
      aion2_character_name: selected.character_name,
      aion2_server_id: selected.server_id,
      aion2_synced_at: selected.synced_at,
    })
    .eq("id", user.id);

  if (profileError) {
    return NextResponse.json(
      { error: "프로필 갱신에 실패했습니다: " + profileError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
