"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LinkButton } from "@/components/link-button";

// Client-side auth-aware nav so the landing page can stay fully static
// (served from the CDN edge) instead of doing a server-side session check.
export function AuthNav() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setLoggedIn(!!session);
    });
  }, []);

  if (loggedIn) {
    return <LinkButton href="/dashboard">대시보드</LinkButton>;
  }

  return (
    <>
      <LinkButton href="/login" variant="ghost">
        로그인
      </LinkButton>
      <LinkButton href="/signup" variant="outline">
        회원가입
      </LinkButton>
    </>
  );
}
