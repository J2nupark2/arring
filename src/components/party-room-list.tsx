"use client";

import { useMemo, useState } from "react";
import { Lock, Search } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type PublicRoom = {
  id: string;
  code: string;
  title: string;
  max_members: number;
  created_at: string;
  creator_nickname: string;
  creator_server: string | null;
  member_count: number;
  has_password?: boolean;
};

function timeAgo(iso: string) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  return `${Math.floor(minutes / 60)}시간 전`;
}

export function PartyRoomList({ rooms }: { rooms: PublicRoom[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter((room) =>
      [room.title, room.creator_nickname, room.creator_server ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rooms, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="방 제목, 닉네임, 서버로 검색..."
          className="pl-9"
          aria-label="파티 검색"
        />
      </div>

      {rooms.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">모집 중인 파티가 없습니다</CardTitle>
            <CardDescription>첫 번째 파티를 모집해보세요!</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      )}

      {rooms.length > 0 && filtered.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">검색 결과가 없습니다</CardTitle>
            <CardDescription>다른 검색어로 시도해보세요.</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      )}

      {filtered.map((room) => {
        const full = room.member_count >= room.max_members;
        return (
          <Card key={room.id}>
            <CardContent className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-1.5 truncate font-medium">
                  {room.has_password && (
                    <Lock className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  {room.title}
                </span>
                <span className="text-sm text-muted-foreground">
                  {room.creator_nickname}
                  {room.creator_server && ` (${room.creator_server})`} ·{" "}
                  {timeAgo(room.created_at)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Badge variant={full ? "secondary" : "outline"}>
                  {room.member_count}/{room.max_members}명
                </Badge>
                {full ? (
                  <Button disabled variant="secondary">
                    정원 마감
                  </Button>
                ) : (
                  <LinkButton href={`/room/${room.code}`}>입장</LinkButton>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
