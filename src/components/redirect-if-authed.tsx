"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Bounces an already-signed-in visitor (real account or guest) straight to
// /party. Runs client-side so the root page itself can stay a static,
// CDN-served shell instead of paying a server-side session check on every
// visit.
export function RedirectIfAuthed({ to }: { to: string }) {
  const router = useRouter();

  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        if (session) router.replace(to);
      });
  }, [router, to]);

  return null;
}
