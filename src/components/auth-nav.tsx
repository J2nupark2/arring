"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

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
    return (
      <Button asChild>
        <Link href="/dashboard">대시보드</Link>
      </Button>
    );
  }

  return (
    <>
      <Button variant="ghost" asChild>
        <Link href="/login">로그인</Link>
      </Button>
      <Button variant="outline" asChild>
        <Link href="/signup">회원가입</Link>
      </Button>
    </>
  );
}
