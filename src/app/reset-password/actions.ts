"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { translateAuthError } from "@/lib/auth-errors";

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");

  if (password.length < 8) {
    redirect(`/reset-password?error=${encodeURIComponent("비밀번호는 8자 이상이어야 합니다.")}`);
  }
  if (password !== confirmation) {
    redirect(`/reset-password?error=${encodeURIComponent("비밀번호 확인이 일치하지 않습니다.")}`);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?error=${encodeURIComponent("재설정 링크가 만료되었습니다. 다시 요청해주세요.")}`);
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(`/reset-password?error=${encodeURIComponent(translateAuthError(error.message))}`);
  }

  redirect("/login?passwordUpdated=1");
}
