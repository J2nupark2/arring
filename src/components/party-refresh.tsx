"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function PartyRefresh() {
  const router = useRouter();
  const [refreshing, startRefreshing] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    let refreshTimer: number | null = null;

    function scheduleRefresh() {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        router.refresh();
      }, 120);
    }

    const channel = supabase
      .channel(`party-page:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_requests" },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_queue" },
        scheduleRefresh,
      )
      .subscribe();

    return () => {
      if (refreshTimer) window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={refreshing}
      onClick={() => startRefreshing(() => router.refresh())}
      aria-label="파티 목록 새로고침"
    >
      {refreshing ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <RefreshCw className="size-4" />
      )}
      새로고침
    </Button>
  );
}
