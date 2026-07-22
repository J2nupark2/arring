"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { translateAuthError } from "@/lib/auth-errors";
import { enforceActionRateLimit } from "@/lib/rate-limit";

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://a2rring.com";
}

function getEmailRedirectTo() {
  return `${getSiteUrl()}/auth/callback?next=/party`;
}

export async function signup(formData: FormData) {
  const email = (formData.get("email") as string)?.trim();
  const emailConfirmation = (formData.get("emailConfirmation") as string)?.trim();
  const password = formData.get("password") as string;

  if (!email || !password) {
    redirect("/signup?error=" + encodeURIComponent("이메일과 비밀번호를 입력해주세요."));
  }
  if (email !== emailConfirmation) {
    redirect("/signup?error=" + encodeURIComponent("이메일과 이메일 확인이 일치하지 않습니다."));
  }
  if (password.length < 8) {
    redirect("/signup?error=" + encodeURIComponent("비밀번호는 8자 이상이어야 합니다."));
  }

  const rateLimitError = await enforceActionRateLimit({
    scope: "auth-signup",
    limit: 5,
    windowSeconds: 3600,
  });
  if (rateLimitError) {
    redirect("/signup?error=" + encodeURIComponent(rateLimitError));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getEmailRedirectTo(),
    },
  });

  if (error) {
    // A duplicate submit (double click) can land here after the first
    // request already created the account and signed the user in; if we
    // have a session, treat it as success instead of showing an error.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      redirect("/party?welcome=1");
    }

    redirect("/signup?error=" + encodeURIComponent(translateAuthError(error.message)));
  }

  // If email confirmation is disabled, signUp already returns an active
  // session, skip the "check your email" step and go straight in.
  if (data.session) {
    redirect("/party?welcome=1");
  }

  redirect("/signup/check-email?email=" + encodeURIComponent(email));
}

export async function resendSignupEmail(formData: FormData) {
  const email = (formData.get("email") as string)?.trim();

  if (!email) {
    redirect("/signup?error=" + encodeURIComponent("인증 메일을 받을 이메일을 다시 입력해주세요."));
  }

  const rateLimitError = await enforceActionRateLimit({
    scope: "auth-signup-resend",
    limit: 5,
    windowSeconds: 3600,
  });
  if (rateLimitError) {
    redirect(
      `/signup/check-email?email=${encodeURIComponent(email)}&error=${encodeURIComponent(rateLimitError)}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: getEmailRedirectTo(),
    },
  });

  if (error) {
    redirect(
      `/signup/check-email?email=${encodeURIComponent(email)}&error=${encodeURIComponent(
        translateAuthError(error.message),
      )}`,
    );
  }

  redirect(`/signup/check-email?email=${encodeURIComponent(email)}&resent=1`);
}
