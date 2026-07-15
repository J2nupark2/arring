"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { translateAuthError } from "@/lib/auth-errors";
import { enforceActionRateLimit } from "@/lib/rate-limit";

function normalizeNext(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.startsWith("/")) return "/party";
  if (value.startsWith("//")) return "/party";
  return value;
}

export async function login(formData: FormData) {
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;
  const next = normalizeNext(formData.get("next"));

  if (!email || !password) {
    redirect(
      `/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent(
        "이메일과 비밀번호를 입력해주세요.",
      )}`,
    );
  }

  const rateLimitError = await enforceActionRateLimit({
    scope: "auth-login",
    identifier: email.toLowerCase(),
    limit: 10,
    windowSeconds: 600,
  });
  if (rateLimitError) {
    redirect(
      `/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent(rateLimitError)}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(
      `/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent(
        translateAuthError(error.message),
      )}`,
    );
  }

  redirect(next);
}
