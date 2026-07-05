"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useFriends } from "@/hooks/use-friends";

type FriendsValue = ReturnType<typeof useFriends>;

// Inert fallback for the rare AppHeader usages with no wrapping provider
// (e.g. the invalid-room/full-room screens in room/[code]/page.tsx, which
// don't render the friends UI at all) — keeps useFriendsContext callable
// unconditionally instead of throwing.
const inertValue: FriendsValue = {
  friends: [],
  incoming: [],
  loading: false,
  refresh: async () => {},
  respond: async () => {},
  remove: async () => {},
};

const FriendsContext = createContext<FriendsValue>(inertValue);

// A single shared useFriends() instance per page instead of one per
// consumer (AppHeader's badge + the sidebar/sheet's full list both used to
// poll independently) — needed so the new-request/new-message toasts below
// fire once per event instead of once per mounted consumer.
export function FriendsProvider({
  isGuest,
  children,
}: {
  isGuest: boolean;
  children: React.ReactNode;
}) {
  const value = useFriends(isGuest);
  const seenRequestIds = useRef<Set<string> | null>(null);
  const lastUnread = useRef<Map<string, number> | null>(null);

  useEffect(() => {
    if (isGuest) return;

    if (seenRequestIds.current) {
      for (const req of value.incoming) {
        if (!seenRequestIds.current.has(req.request_id)) {
          toast(`${req.nickname}님이 친구 요청을 보냈습니다`);
        }
      }
    }
    seenRequestIds.current = new Set(value.incoming.map((r) => r.request_id));
  }, [value.incoming, isGuest]);

  useEffect(() => {
    if (isGuest) return;

    if (lastUnread.current) {
      for (const friend of value.friends) {
        const prev = lastUnread.current.get(friend.user_id) ?? 0;
        if (friend.unread_count > prev) {
          toast(`${friend.nickname}님에게서 메시지가 왔습니다`);
        }
      }
    }
    lastUnread.current = new Map(
      value.friends.map((f) => [f.user_id, f.unread_count]),
    );
  }, [value.friends, isGuest]);

  return (
    <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>
  );
}

export function useFriendsContext() {
  return useContext(FriendsContext);
}
