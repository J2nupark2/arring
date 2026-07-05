"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Check,
  MessageCircle,
  PhoneIncoming,
  RefreshCw,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useFriendsContext } from "@/components/friends/friends-provider";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { FriendChatDialog } from "@/components/friends/friend-chat-dialog";

// currentRoomCode is set only when this is rendered from inside an active
// call room, enabling the "초대" (invite into my room) action per friend.
export function FriendListContent({
  isGuest,
  currentRoomCode,
}: {
  isGuest: boolean;
  currentRoomCode?: string;
}) {
  const { friends, incoming, loading, refresh, respond, remove } =
    useFriendsContext();
  const [chatWith, setChatWith] = useState<{
    id: string;
    nickname: string;
  } | null>(null);

  async function inviteToMyRoom(nickname: string) {
    if (!currentRoomCode) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/room/${currentRoomCode}`,
      );
      toast.success(`초대 링크가 복사됐습니다. ${nickname}님에게 전달해주세요.`);
    } catch {
      toast.error("복사에 실패했습니다.");
    }
  }

  if (isGuest) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
        <Users className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          친구 추가는 회원가입 후 이용할 수 있어요.
        </p>
        <Button asChild size="sm">
          <Link href="/signup">회원가입하기</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 pt-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          친구 목록
          {incoming.length > 0 && (
            <span className="flex size-4.5 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
              {incoming.length}
            </span>
          )}
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => refresh()}
          aria-label="친구 목록 새로고침"
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {incoming.length > 0 && (
        <div className="flex flex-col gap-2 px-4 pt-3">
          <span className="text-xs font-medium text-muted-foreground">
            받은 친구 요청
          </span>
          {incoming.map((req) => (
            <div
              key={req.request_id}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Avatar className="size-6 shrink-0">
                  <AvatarFallback>{req.nickname.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <span className="truncate text-sm">
                  {req.nickname}
                  {req.server && ` (${req.server})`}
                </span>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="수락"
                  onClick={() => respond(req.request_id, true)}
                >
                  <Check className="size-4 text-green-500" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="거절"
                  onClick={() => respond(req.request_id, false)}
                >
                  <X className="size-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
          <Separator className="mt-1" />
        </div>
      )}

      {!loading && friends.length === 0 && incoming.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center">
          <Users className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">아직 친구가 없어요.</p>
          <p className="text-xs text-muted-foreground">
            통화방에서 파티원에게 친구 추가를 해보세요.
          </p>
        </div>
      )}

      {friends.length > 0 && (
        <div className="flex flex-col gap-2 px-4 py-3">
          {incoming.length > 0 && (
            <span className="text-xs font-medium text-muted-foreground">
              친구
            </span>
          )}
          {friends.map((friend) => {
            const canInvite =
              !!currentRoomCode && friend.current_room_code !== currentRoomCode;
            return (
              <div
                key={friend.user_id}
                className="flex flex-col gap-1.5 rounded-md border px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="relative shrink-0">
                      <Avatar className="size-6">
                        <AvatarFallback>
                          {friend.nickname.slice(0, 1)}
                        </AvatarFallback>
                      </Avatar>
                      {friend.is_online && (
                        <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-green-500 ring-2 ring-card" />
                      )}
                    </span>
                    <span className="truncate text-sm">
                      {friend.nickname}
                      {friend.server && ` (${friend.server})`}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="relative"
                      aria-label={`${friend.nickname}님과 채팅`}
                      onClick={() =>
                        setChatWith({ id: friend.user_id, nickname: friend.nickname })
                      }
                    >
                      <MessageCircle className="size-4 text-muted-foreground" />
                      {friend.unread_count > 0 && (
                        <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-semibold text-destructive-foreground">
                          {friend.unread_count > 9 ? "9+" : friend.unread_count}
                        </span>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="친구 삭제"
                      onClick={() => remove(friend.user_id)}
                    >
                      <UserMinus className="size-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
                {(friend.current_room_code || canInvite) && (
                  <div className="flex flex-wrap items-center gap-1.5 pl-8">
                    {friend.current_room_code && (
                      <>
                        <span className="rounded-full bg-green-500/15 px-1.5 py-0.5 text-[10px] font-medium text-green-500">
                          통화중
                        </span>
                        <Button size="sm" variant="secondary" asChild>
                          <Link href={`/room/${friend.current_room_code}`}>
                            <PhoneIncoming className="size-3.5" />
                            참여
                          </Link>
                        </Button>
                      </>
                    )}
                    {canInvite && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => inviteToMyRoom(friend.nickname)}
                      >
                        <UserPlus className="size-3.5" />
                        초대
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {chatWith && (
        <FriendChatDialog
          friendId={chatWith.id}
          friendNickname={chatWith.nickname}
          open={!!chatWith}
          onOpenChange={(next) => {
            if (!next) setChatWith(null);
          }}
          onRead={refresh}
        />
      )}
    </div>
  );
}
