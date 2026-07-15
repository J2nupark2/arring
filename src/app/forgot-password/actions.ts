"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { translateAuthError } from "@/lib/auth-errors";

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    redirect(`/forgot-password?error=${encodeURIComponent("이메일을 입력해주세요.")}`);
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://a2rring.com";
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
  });

  if (error) {
    redirect(`/forgot-password?error=${encodeURIComponent(translateAuthError(error.message))}`);
  }

  redirect(`/forgot-password?sent=1&email=${encodeURIComponent(email)}`);
}
