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

function showBrowserNotification(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const notification = new Notification(title, {
    body,
    icon: "/icon.svg",
    tag: "arring-matching",
  });
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
}

function playMatchingSound() {
  if (typeof window === "undefined") return;
  const AudioContextClass =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    const context = new AudioContextClass();
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.75);
    gain.connect(context.destination);

    [0, 0.16, 0.32].forEach((offset, index) => {
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(
        [784, 988, 1175][index],
        context.currentTime + offset,
      );
      oscillator.connect(gain);
      oscillator.start(context.currentTime + offset);
      oscillator.stop(context.currentTime + offset + 0.16);
    });

    window.setTimeout(() => void context.close(), 1100);
  } catch {
    // Browsers can block audio before the user interacts with the site.
  }
}

const MATCH_CONFIRMED_TITLE = "\uD30C\uD2F0 \uB9E4\uCE6D \uC644\uB8CC";
const MATCH_CONFIRMED_BODY =
  "\uD30C\uD2F0\uAC00 \uD655\uC815\uB418\uC5B4 \uBC29\uC73C\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4.";
const MATCH_READY_TITLE =
  "\uB9E4\uCE6D \uD6C4\uBCF4\uAC00 \uC7A1\uD614\uC2B5\uB2C8\uB2E4";
const MATCH_READY_BODY =
  "30\uCD08 \uC548\uC5D0 \uC218\uB77D\uD574\uC57C \uD30C\uD2F0\uAC00 \uD655\uC815\uB429\uB2C8\uB2E4.";

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
  const lastNotifiedKey = useRef<string | null>(null);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    function handleImmediateStatus(event: Event) {
      const status = (event as CustomEvent<MatchStatus>).detail;
      if (!status) return;
      if (status.matched && status.roomCode) {
        setMatchStatus(null);
        if (pathnameRef.current !== `/room/${status.roomCode}`) {
          router.push(`/room/${status.roomCode}`);
        }
        return;
      }
      setMatchStatus(status.active ? status : null);
    }

    window.addEventListener("arring:matching-status", handleImmediateStatus);
    return () => {
      window.removeEventListener("arring:matching-status", handleImmediateStatus);
    };
  }, [router]);

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
          playMatchingSound();
          showBrowserNotification(MATCH_CONFIRMED_TITLE, MATCH_CONFIRMED_BODY);
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
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetchMatchStatus(sessionStartedAt.current).then((status) => {
        if (!status) return;
        if (status.matched && status.roomCode) {
          setMatchStatus(null);
          if (pathnameRef.current !== `/room/${status.roomCode}`) {
            router.push(`/room/${status.roomCode}`);
          }
          return;
        }
        setMatchStatus(status.active ? status : null);
      });
    }, 2000);
    return () => window.clearInterval(id);
  }, [router]);

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

  useEffect(() => {
    if (!matchStatus?.temporaryMatch) return;
    const key = `temporary:${matchStatus.temporaryMatch.id}`;
    if (lastNotifiedKey.current === key) return;
    lastNotifiedKey.current = key;
    playMatchingSound();
    showBrowserNotification(MATCH_READY_TITLE, MATCH_READY_BODY);
  }, [matchStatus?.temporaryMatch]);

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
        playMatchingSound();
        showBrowserNotification(MATCH_CONFIRMED_TITLE, MATCH_CONFIRMED_BODY);
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
