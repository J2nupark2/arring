"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const COOLDOWN_SECONDS = 60;

function getRemainingSeconds(syncedAt: string | null | undefined) {
  if (!syncedAt) return 0;
  const elapsed = (Date.now() - new Date(syncedAt).getTime()) / 1000;
  return Math.max(0, Math.ceil(COOLDOWN_SECONDS - elapsed));
}

export function CharacterRefreshButton({
  characterRowId,
  syncedAt,
}: {
  characterRowId: string;
  syncedAt: string | null;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [remaining, setRemaining] = useState(() => getRemainingSeconds(syncedAt));
  const disabled = refreshing || remaining > 0;

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setInterval(() => {
      setRemaining((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [remaining]);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/aion2/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: characterRowId }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 429 && Number(data.retryAfterSeconds) > 0) {
          setRemaining(Number(data.retryAfterSeconds));
        }
        toast.error(data.error ?? "캐릭터 갱신에 실패했습니다.");
        return;
      }
      setRemaining(COOLDOWN_SECONDS);
      toast.success("캐릭터 정보를 갱신했습니다.");
      router.refresh();
    } catch {
      toast.error("캐릭터 갱신에 실패했습니다.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Button variant="outline" onClick={refresh} disabled={disabled}>
      {refreshing ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <RefreshCw className="size-4" />
      )}
      {remaining > 0 ? `${remaining}초 후 갱신` : "캐릭터 갱신"}
    </Button>
  );
}
