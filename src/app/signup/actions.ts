"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { translateAuthError } from "@/lib/auth-errors";

export async function signup(formData: FormData) {
  const nickname = (formData.get("nickname") as string)?.trim();
  const server = (formData.get("server") as string)?.trim() || null;
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;

  if (!nickname || !email || !password) {
    redirect("/signup?error=" + encodeURIComponent("모든 항목을 입력해주세요."));
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { nickname, server },
      emailRedirectTo: `${siteUrl}/auth/callback?next=/dashboard`,
    },
  });

  if (error) {
    // A duplicate submit (double click) can land here after the first
    // request already created the account and signed the user in — if we
    // have a session, treat it as success instead of showing an error.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      redirect("/dashboard?welcome=1");
    }

    redirect("/signup?error=" + encodeURIComponent(translateAuthError(error.message)));
  }

  // If email confirmation is disabled, signUp already returns an active
  // session — skip the "check your email" step and go straight in.
  if (data.session) {
    redirect("/dashboard?welcome=1");
  }

  redirect("/signup/check-email?email=" + encodeURIComponent(email));
}
