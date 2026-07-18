"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

export type MatchingInvite = {
  inviteId: string;
  senderId: string;
  matchRequestId: string | null;
  draftId: string | null;
  nickname: string;
  dungeonName: string;
  stage: number;
  minCombatPower: number;
  createdAt: string;
};

export function useMatchingInvites(isGuest: boolean) {
  const [incoming, setIncoming] = useState<MatchingInvite[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = useCallback(async () => {
    if (isGuest) return;
    const res = await fetch("/api/matching/invites", { method: "GET" });
    if (!res.ok) return;
    const data = (await res.json()) as { invites?: MatchingInvite[] };
    setIncoming(data.invites ?? []);
  }, [isGuest]);

  useEffect(() => {
    if (isGuest) return;

    void Promise.resolve().then(() => refresh());
    const supabase = createClient();
    let cancelled = false;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || cancelled) return;
      const channel = supabase
        .channel(`matching-invites:${user.id}:${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "matching_invites",
            filter: `receiver_id=eq.${user.id}`,
          },
          () => refresh(),
        )
        .subscribe();
      if (cancelled) {
        void supabase.removeChannel(channel);
        return;
      }
      channelRef.current = channel;
    });

    return () => {
      cancelled = true;
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [refresh, isGuest]);

  const respond = useCallback(
    async (inviteId: string, accept: boolean) => {
      const res = await fetch("/api/matching/invites", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteId, accept }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "파티 초대 처리에 실패했습니다.");
        return;
      }
      setIncoming((prev) => prev.filter((invite) => invite.inviteId !== inviteId));
      const result = data as { ok: true; accepted: boolean; draftId?: string | null };
      toast.success(accept ? "파티 매칭 대기에 합류했습니다." : "파티 초대를 거절했습니다.");
      return result;
    },
    [],
  );

  return { incoming, refresh, respond };
}
