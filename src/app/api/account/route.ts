import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.is_anonymous || !user.email) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const limited = await enforceRateLimit(request, {
    scope: "account-delete",
    identifier: user.id,
    limit: 5,
    windowSeconds: 3600,
  });
  if (limited) return limited;

  let body: { password?: string; confirmation?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  if (body.confirmation !== "회원 탈퇴") {
    return NextResponse.json({ error: "확인 문구를 정확히 입력해주세요." }, { status: 400 });
  }
  if (!body.password) {
    return NextResponse.json({ error: "현재 비밀번호를 입력해주세요." }, { status: 400 });
  }

  const { error: passwordError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: body.password,
  });
  if (passwordError) {
    return NextResponse.json({ error: "현재 비밀번호가 올바르지 않습니다." }, { status: 403 });
  }

  const { error: deleteError } = await createAdminClient().auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error(JSON.stringify({
      event: "account_delete_failed",
      userId: user.id,
      message: deleteError.message,
    }));
    return NextResponse.json(
      { error: "계정 삭제에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
