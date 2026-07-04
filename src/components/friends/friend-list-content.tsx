"use client";

import Link from "next/link";
import { Check, RefreshCw, UserMinus, Users, X } from "lucide-react";
import { useFriends } from "@/hooks/use-friends";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";

export function FriendListContent({ isGuest }: { isGuest: boolean }) {
  const { friends, incoming, loading, refresh, respond, remove } =
    useFriends(isGuest);

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
        <h2 className="text-sm font-semibold">친구 목록</h2>
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
          {friends.map((friend) => (
            <div
              key={friend.user_id}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Avatar className="size-6 shrink-0">
                  <AvatarFallback>{friend.nickname.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <span className="truncate text-sm">
                  {friend.nickname}
                  {friend.server && ` (${friend.server})`}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="친구 삭제"
                onClick={() => remove(friend.user_id)}
              >
                <UserMinus className="size-4 text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
