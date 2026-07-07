"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

export type Friend = {
  user_id: string;
  nickname: string;
  server: string | null;
  friends_since: string;
  is_online: boolean;
  current_room_code: string | null;
  unread_count: number;
  class_name: string | null;
  combat_power: number | null;
};

export type IncomingRequest = {
  request_id: string;
  sender_id: string;
  nickname: string;
  server: string | null;
  created_at: string;
};

export type FriendCandidate = {
  user_id: string;
  nickname: string;
  server: string | null;
  email: string | null;
  relation_status: "none" | "friends" | "sent" | "received";
};

const POLL_MS = 15000;

export function useFriends(isGuest: boolean) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [loading, setLoading] = useState(!isGuest);

  const refresh = useCallback(async () => {
    if (isGuest) return;
    const supabase = createClient();
    const [friendsRes, incomingRes] = await Promise.all([
      supabase.rpc("list_friends"),
      supabase.rpc("list_incoming_friend_requests"),
      // Piggyback the online heartbeat on the same poll cycle instead of
      // opening a dedicated realtime presence channel.
      supabase.rpc("touch_presence"),
    ]);
    if (!friendsRes.error) setFriends(friendsRes.data ?? []);
    if (!incomingRes.error) setIncoming(incomingRes.data ?? []);
    setLoading(false);
  }, [isGuest]);

  const channelsRef = useRef<RealtimeChannel[]>([]);

  useEffect(() => {
    void Promise.resolve().then(() => refresh());
    if (isGuest) return;

    const id = setInterval(refresh, POLL_MS);
    const supabase = createClient();
    let cancelled = false;

    // Friend requests and messages used to only ever update on the next
    // 15s poll tick. That's kept as a fallback (in case a realtime
    // connection drops), but both now also push instantly.
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || cancelled) return;
      const channel = supabase
        .channel(`friend-updates:${user.id}:${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "friend_requests",
            filter: `receiver_id=eq.${user.id}`,
          },
          () => refresh(),
        )
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "direct_messages",
            filter: `receiver_id=eq.${user.id}`,
          },
          () => refresh(),
        )
        .subscribe();
      if (cancelled) {
        void supabase.removeChannel(channel);
        return;
      }
      channelsRef.current.push(channel);
    });

    return () => {
      cancelled = true;
      clearInterval(id);
      channelsRef.current.forEach((c) => supabase.removeChannel(c));
      channelsRef.current = [];
    };
  }, [refresh, isGuest]);

  const respond = useCallback(
    async (requestId: string, accept: boolean) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("respond_friend_request", {
        request_id: requestId,
        accept,
      });
      if (error) {
        toast.error("처리에 실패했습니다: " + error.message);
        return;
      }
      toast.success(accept ? "친구 요청을 수락했습니다" : "친구 요청을 거절했습니다");
      refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (userId: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("remove_friend", {
        other_user_id: userId,
      });
      if (error) {
        toast.error("삭제에 실패했습니다: " + error.message);
        return;
      }
      toast.success("친구를 삭제했습니다");
      refresh();
    },
    [refresh],
  );

  return { friends, incoming, loading, refresh, respond, remove };
}

export async function sendFriendRequest(targetId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("send_friend_request", {
    target_id: targetId,
  });

  if (error) {
    toast.error("친구 추가에 실패했습니다: " + error.message);
    return;
  }

  const messages: Record<string, string> = {
    sent: "친구 요청을 보냈습니다",
    auto_accepted: "서로 요청을 보내서 바로 친구가 되었습니다!",
    already_friends: "이미 친구예요",
    already_sent: "이미 요청을 보냈어요",
  };
  toast(messages[data as string] ?? "요청을 보냈습니다");
}

export async function searchFriendCandidates(query: string) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("search_friend_candidates", {
    search_query: query,
  });

  if (error) {
    toast.error("친구 검색에 실패했습니다: " + error.message);
    return [];
  }

  return (data ?? []) as FriendCandidate[];
}
