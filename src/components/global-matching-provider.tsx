"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import {
  MatchFloatingStatus,
  type MatchStatus,
} from "@/components/matching-floating-status";

async function fetchMatchStatus(since: string) {
  const res = await fetch(`/api/matching?since=${encodeURIComponent(since)}`, {
    method: "GET",
  });
  if (!res.ok) return null;
  return (await res.json()) as MatchStatus;
}

async function cancelMatch() {
  const res = await fetch("/api/matching", { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error ?? "매칭 취소에 실패했습니다.");
  }
}

async function respondTemporaryMatch(action: "accept" | "reject") {
  const res = await fetch("/api/matching", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "매칭 응답 처리에 실패했습니다.");
  return data as MatchStatus;
}

export function GlobalMatchingProvider() {
  const router = useRouter();
  const pathname = usePathname();
  const [matchStatus, setMatchStatus] = useState<MatchStatus | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [responding, setResponding] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const sessionStartedAt = useRef(new Date().toISOString());
  const refreshTimer = useRef<number | null>(null);
  const suppressRealtimeRefreshUntil = useRef(0);
  const lastNavigatedRoomCode = useRef<string | null>(null);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const supabase = createClient();
    const channels: RealtimeChannel[] = [];
    let active = true;

    async function refreshStatus() {
      suppressRealtimeRefreshUntil.current = Date.now() + 1200;
      const status = await fetchMatchStatus(sessionStartedAt.current);
      if (!active || !status) return;

      if (status.matched && status.roomCode) {
        setMatchStatus(null);
        if (lastNavigatedRoomCode.current !== status.roomCode) {
          lastNavigatedRoomCode.current = status.roomCode;
          toast.success("파티가 매칭됐습니다. 방으로 이동합니다.");
        }
        if (pathnameRef.current !== `/room/${status.roomCode}`) {
          router.push(`/room/${status.roomCode}`);
        }
        return;
      }

      setMatchStatus(
        status.state === "waiting" || status.state === "processing" || status.active
          ? status
          : null,
      );
    }

    function scheduleRefresh(delay = 80) {
      if (Date.now() < suppressRealtimeRefreshUntil.current) return;
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = null;
        void refreshStatus();
      }, delay);
    }

    void refreshStatus();

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || user.is_anonymous || !active) return;

      const ownRows = supabase
        .channel(`global-matching:${user.id}:${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "match_requests",
            filter: `leader_id=eq.${user.id}`,
          },
          () => scheduleRefresh(),
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "match_queue",
            filter: `user_id=eq.${user.id}`,
          },
          () => scheduleRefresh(),
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "matching_invites",
            filter: `receiver_id=eq.${user.id}`,
          },
          () => scheduleRefresh(),
        )
        .subscribe();

      const acceptanceRows = supabase
        .channel(`global-matching-acceptance:${user.id}:${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "temporary_matches" },
          () => scheduleRefresh(),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "match_responses" },
          () => scheduleRefresh(),
        )
        .subscribe();

      channels.push(ownRows, acceptanceRows);
    });

    return () => {
      active = false;
      if (refreshTimer.current) {
        window.clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
      channels.forEach((channel) => {
        void supabase.removeChannel(channel);
      });
    };
  }, [router]);

  useEffect(() => {
    if (!matchStatus?.active) return;
    const id = window.setInterval(() => {
      void fetchMatchStatus(sessionStartedAt.current);
    }, 45000);
    return () => window.clearInterval(id);
  }, [matchStatus?.active]);

  useEffect(() => {
    if (!matchStatus?.temporaryMatch && !matchStatus?.autoLeadEligibleAt) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [matchStatus?.temporaryMatch, matchStatus?.autoLeadEligibleAt]);

  useEffect(() => {
    const timestamps = [
      matchStatus?.autoLeadEligibleAt,
      matchStatus?.temporaryMatch?.expiresAt,
    ].filter((value): value is string => !!value);
    if (timestamps.length === 0) return;

    const timers = timestamps.map((timestamp) => {
      const delay = Math.max(0, new Date(timestamp).getTime() - Date.now() + 150);
      return window.setTimeout(() => {
        void fetchMatchStatus(sessionStartedAt.current).then((status) => {
          if (!status) return;
          setMatchStatus(status.active ? status : null);
          if (status.matched && status.roomCode) {
            router.push(`/room/${status.roomCode}`);
          }
        });
      }, delay);
    });

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [matchStatus?.autoLeadEligibleAt, matchStatus?.temporaryMatch?.expiresAt, router]);

  async function onCancelMatch() {
    setCancelling(true);
    try {
      await cancelMatch();
      sessionStartedAt.current = new Date().toISOString();
      setMatchStatus(null);
      toast.success("매칭 대기를 취소했습니다.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "매칭 취소에 실패했습니다.");
    } finally {
      setCancelling(false);
    }
  }

  async function onRespondTemporaryMatch(action: "accept" | "reject") {
    setResponding(true);
    try {
      const result = await respondTemporaryMatch(action);
      if (result.matched && result.roomCode) {
        setMatchStatus(null);
        toast.success("파티가 확정됐습니다. 방으로 이동합니다.");
        router.push(`/room/${result.roomCode}`);
        return;
      }
      if (action === "accept") {
        toast.success("수락했습니다. 다른 파티원의 응답을 기다립니다.");
        setMatchStatus(result.active ? result : null);
      } else {
        toast.success("매칭을 거절했습니다.");
        setMatchStatus(null);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "매칭 응답 처리에 실패했습니다.");
    } finally {
      setResponding(false);
    }
  }

  if (!matchStatus?.active) return null;

  return (
    <MatchFloatingStatus
      status={matchStatus}
      cancelling={cancelling}
      responding={responding}
      nowMs={nowMs}
      onCancel={onCancelMatch}
      onRespond={onRespondTemporaryMatch}
    />
  );
}
