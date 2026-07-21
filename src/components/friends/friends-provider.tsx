"use client";

import { createContext, useContext, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useFriends } from "@/hooks/use-friends";
import {
  useMatchingInvites,
  type MatchingInvite,
} from "@/hooks/use-matching-invites";
import { useRoomInvites, type RoomInvite } from "@/hooks/use-room-invites";

type FriendsValue = ReturnType<typeof useFriends> & {
  incomingInvites: RoomInvite[];
  respondInvite: (inviteId: string, accept: boolean) => Promise<void>;
  incomingMatchingInvites: MatchingInvite[];
  respondMatchingInvite: (
    inviteId: string,
    accept: boolean,
  ) => Promise<{ ok: true; accepted: boolean; draftId?: string | null } | undefined>;
};

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
  incomingInvites: [],
  respondInvite: async () => {},
  incomingMatchingInvites: [],
  respondMatchingInvite: async () => undefined,
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
  const router = useRouter();
  const value = useFriends(isGuest);
  const { incoming: incomingInvites, respond: respondInvite } =
    useRoomInvites(isGuest);
  const {
    incoming: incomingMatchingInvites,
    respond: respondMatchingInvite,
  } = useMatchingInvites(isGuest);
  const seenRequestIds = useRef<Set<string> | null>(null);
  const lastUnread = useRef<Map<string, number> | null>(null);
  const lastOnline = useRef<Map<string, boolean> | null>(null);
  const onlineSnapshotReady = useRef(false);
  const seenInviteIds = useRef<Set<string> | null>(null);
  const seenMatchingInviteIds = useRef<Set<string> | null>(null);

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

  useEffect(() => {
    if (isGuest) return;

    if (!onlineSnapshotReady.current) {
      if (!value.loading) {
        lastOnline.current = new Map(
          value.friends.map((f) => [f.user_id, f.is_online]),
        );
        onlineSnapshotReady.current = true;
      }
      return;
    }

    if (lastOnline.current) {
      for (const friend of value.friends) {
        const hadPreviousState = lastOnline.current.has(friend.user_id);
        const wasOnline = lastOnline.current.get(friend.user_id) ?? false;
        if (hadPreviousState && !wasOnline && friend.is_online) {
          toast(`${friend.nickname}님이 로그인했습니다`);
        }
      }
    }
    lastOnline.current = new Map(
      value.friends.map((f) => [f.user_id, f.is_online]),
    );
  }, [value.friends, value.loading, isGuest]);

  useEffect(() => {
    if (isGuest) return;

    if (seenInviteIds.current) {
      for (const invite of incomingInvites) {
        if (!seenInviteIds.current.has(invite.invite_id)) {
          toast(`${invite.nickname}님이 통화방으로 초대했습니다`, {
            action: {
              label: "참가하기",
              onClick: async () => {
                await respondInvite(invite.invite_id, true);
                router.push(`/room/${invite.room_code}`);
              },
            },
          });
        }
      }
    }
    seenInviteIds.current = new Set(incomingInvites.map((i) => i.invite_id));
  }, [incomingInvites, isGuest, respondInvite, router]);

  useEffect(() => {
    if (isGuest) return;

    if (seenMatchingInviteIds.current) {
      for (const invite of incomingMatchingInvites) {
        if (!seenMatchingInviteIds.current.has(invite.inviteId)) {
          toast(`${invite.nickname}님이 파티 매칭에 초대했습니다`, {
            action: {
              label: "수락",
              onClick: async () => {
                const result = await respondMatchingInvite(invite.inviteId, true);
                const draftId = result?.draftId ?? invite.draftId;
                if (draftId) {
                  router.push(`/party?matchingDraft=${encodeURIComponent(draftId)}`);
                }
              },
            },
          });
        }
      }
    }
    seenMatchingInviteIds.current = new Set(
      incomingMatchingInvites.map((invite) => invite.inviteId),
    );
  }, [incomingMatchingInvites, isGuest, respondMatchingInvite, router]);

  return (
    <FriendsContext.Provider
      value={{
        ...value,
        incomingInvites,
        respondInvite,
        incomingMatchingInvites,
        respondMatchingInvite,
      }}
    >
      {children}
    </FriendsContext.Provider>
  );
}

export function useFriendsContext() {
  return useContext(FriendsContext);
}
