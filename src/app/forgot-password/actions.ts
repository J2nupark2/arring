"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { translateAuthError } from "@/lib/auth-errors";
import { enforceActionRateLimit } from "@/lib/rate-limit";

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    redirect(`/forgot-password?error=${encodeURIComponent("이메일을 입력해주세요.")}`);
  }

  const rateLimitError = await enforceActionRateLimit({
    scope: "auth-password-reset",
    limit: 5,
    windowSeconds: 3600,
  });
  if (rateLimitError) {
    redirect(`/forgot-password?error=${encodeURIComponent(rateLimitError)}`);
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
