"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

export type RoomInvite = {
  invite_id: string;
  sender_id: string;
  nickname: string;
  room_code: string;
  created_at: string;
};

// A call invite should feel instant, unlike the friend-request/message
// badges which piggyback on the 15s poll — so this also holds a realtime
// subscription on top of the same poll-as-fallback pattern.
export function useRoomInvites(isGuest: boolean) {
  const [incoming, setIncoming] = useState<RoomInvite[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const refresh = useCallback(async () => {
    if (isGuest) return;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("list_incoming_room_invites");
    if (!error) setIncoming(data ?? []);
  }, [isGuest]);

  useEffect(() => {
    void Promise.resolve().then(() => refresh());
    if (isGuest) return;

    const supabase = createClient();
    let cancelled = false;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || cancelled) return;
      const channel = supabase
        .channel(`room-invites:${user.id}:${crypto.randomUUID()}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "room_invites",
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
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [refresh, isGuest]);

  const respond = useCallback(
    async (inviteId: string, accept: boolean) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("respond_room_invite", {
        invite_id: inviteId,
        accept,
      });
      if (error) {
        toast.error("처리에 실패했습니다: " + error.message);
        return;
      }
      setIncoming((prev) => prev.filter((i) => i.invite_id !== inviteId));
    },
    [],
  );

  return { incoming, refresh, respond };
}

export async function sendRoomInvite(receiverId: string, roomCode: string) {
  const supabase = createClient();
  const { error } = await supabase.rpc("send_room_invite", {
    p_receiver_id: receiverId,
    p_room_code: roomCode,
  });
  if (error) {
    toast.error("초대에 실패했습니다: " + error.message);
    return false;
  }
  return true;
}
