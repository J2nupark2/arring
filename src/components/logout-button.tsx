"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

// Signs out in the browser (clears the auth cookies locally) so the click
// doesn't wait on the US serverless function.
export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    if (pending) return;
    setPending(true);
    await createClient().auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <Button variant="ghost" disabled={pending} onClick={onClick}>
      {pending && <Loader2 className="animate-spin" />}
      {pending ? "로그아웃 중..." : "로그아웃"}
    </Button>
  );
}
