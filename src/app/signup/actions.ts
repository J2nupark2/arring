"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { translateAuthError } from "@/lib/auth-errors";

export async function signup(formData: FormData) {
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;

  if (!email || !password) {
    redirect("/signup?error=" + encodeURIComponent("이메일과 비밀번호를 입력해주세요."));
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://a2rring.com";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback?next=/party`,
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
