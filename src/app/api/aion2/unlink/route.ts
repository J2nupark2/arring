import { NextRequest, NextResponse } from "next/server";

import { enforceRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const limited = await enforceRateLimit(request, {
    scope: "aion2-character-unlink",
    identifier: user.id,
    limit: 10,
    windowSeconds: 60,
  });
  if (limited) return limited;

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const id = body.id?.trim() ?? "";
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "삭제할 캐릭터를 선택해 주세요." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("unlink_aion2_character", {
    p_character_row_id: id,
  });
  if (error) {
    if (error.message.includes("character_not_found")) {
      return NextResponse.json({ error: "연동된 캐릭터를 찾을 수 없습니다." }, { status: 404 });
    }
    if (error.message.includes("character_in_active_matching")) {
      return NextResponse.json(
        { error: "현재 매칭에 사용 중인 캐릭터입니다. 매칭을 취소한 뒤 삭제해 주세요." },
        { status: 409 },
      );
    }
    console.error("aion2_character_unlink_failed", error);
    return NextResponse.json({ error: "캐릭터 연동을 삭제하지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json(data);
}
