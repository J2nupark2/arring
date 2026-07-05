"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

export type Friend = {
  user_id: string;
  nickname: string;
  server: string | null;
  friends_since: string;
  is_online: boolean;
  current_room_code: string | null;
};

export type IncomingRequest = {
  request_id: string;
  sender_id: string;
  nickname: string;
  server: string | null;
  created_at: string;
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

  useEffect(() => {
    refresh();
    if (isGuest) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
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
