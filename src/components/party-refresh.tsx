"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Keeps the party list fresh: silent refresh every 15s plus a manual button.
export function PartyRefresh() {
  const router = useRouter();
  const [refreshing, startRefreshing] = useTransition();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 15000);
    return () => clearInterval(id);
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
