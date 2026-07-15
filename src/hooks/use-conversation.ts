"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

export type Message = {
  id: string;
  sender_id: string;
  receiver_id: string;
  body: string;
  created_at: string;
};

// Unread badges are cheap (piggybacked on the friend-list poll, see
// use-friends.ts), but an open chat window needs to feel live — so this
// subscribes to postgres_changes only while a conversation is open, scoped
// to messages from that one friend.
export function useConversation(friendId: string, onRead?: () => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const onReadRef = useRef(onRead);
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    onReadRef.current = onRead;
  }, [onRead]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    async function load() {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const myId = user?.id;
      if (!cancelled) setMyId(myId ?? null);

      const { data, error } = await supabase.rpc("list_messages", {
        other_user_id: friendId,
      });
      if (!cancelled) {
        if (!error) setMessages(data ?? []);
        setLoading(false);
      }
      supabase.rpc("mark_conversation_read", { other_user_id: friendId }).then(() => {
        onReadRef.current?.();
      });
      if (cancelled || !myId) return;

      // The filter only narrows by sender; a message this friend sent to
      // someone else would also match, so the receiver still needs to be
      // checked against my own id client-side.
      const channel = supabase
        .channel(`dm:${friendId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "direct_messages",
            filter: `sender_id=eq.${friendId}`,
          },
          ({ new: row }: { new: Message }) => {
            if (row.receiver_id !== myId) return;
            setMessages((prev) =>
              prev.some((m) => m.id === row.id) ? prev : [...prev, row],
            );
            supabase
              .rpc("mark_conversation_read", { other_user_id: friendId })
              .then(() => onReadRef.current?.());
          },
        )
        .subscribe();

      channelRef.current = channel;
    }
    load();

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [friendId]);

  const send = useCallback(
    async (body: string) => {
      const trimmed = body.trim();
      if (!trimmed) return false;
      setSending(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .rpc("send_message", { p_receiver_id: friendId, p_body: trimmed })
        .single();
      setSending(false);
      if (error) {
        toast.error("메시지 전송에 실패했습니다: " + error.message);
        return false;
      }
      setMessages((prev) => [...prev, data as Message]);
      return true;
    },
    [friendId],
  );

  return { messages, loading, sending, send, myId };
}
