import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { FriendSidebar } from "@/components/friends/friend-sidebar";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/link-button";
import { PartyRefresh } from "@/components/party-refresh";
import { CreateRoomForm, JoinByCodeForm } from "@/components/room-forms";
import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

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

export default async function PartyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; welcome?: string }>;
}) {
  const supabase = await createClient();

  // list_public_rooms() doesn't depend on the caller's identity, so fetch
  // it alongside getUser() instead of waterfalling two round trips.
  const [
    {
      data: { user },
    },
    { data: rooms },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("list_public_rooms"),
  ]);

  if (!user) {
    redirect(`/guest?next=${encodeURIComponent("/party")}`);
  }

  const { error, welcome } = await searchParams;
  const isGuest = user.is_anonymous ?? false;
  const publicRooms = (rooms ?? []) as PublicRoom[];

  return (
    <>
      <AppHeader showFriends isGuest={isGuest} />
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <main className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">파티 구하기</h1>
              <p className="text-sm text-muted-foreground">
                모집 중인 파티에 바로 입장하거나, 직접 파티를 모집해보세요.
              </p>
            </div>
            <PartyRefresh />
          </div>

          {welcome && (
            <div className="rounded-md border border-green-600/30 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-400">
              🎉 회원가입이 완료되었습니다! 이제 통화방을 만들어 파티원을 초대해보세요.
            </div>
          )}
          {isGuest && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-violet-500/30 bg-violet-500/10 px-4 py-3 text-sm text-violet-200">
              <span>게스트로 이용 중입니다. 친구 추가 등 계정 기능은 회원가입 후 이용할 수 있어요.</span>
              <Link href="/signup" className="shrink-0 font-medium underline underline-offset-4">
                회원가입하기
              </Link>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="grid gap-6 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>통화방 만들기</CardTitle>
                <CardDescription>
                  공개로 만들면 이 목록에 노출되고, 비공개로 만들면 코드로만
                  입장할 수 있어요. 비밀번호도 선택적으로 걸 수 있습니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CreateRoomForm />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>코드로 입장하기</CardTitle>
                <CardDescription>
                  친구에게 받은 6자리 통화방 코드를 입력하세요.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <JoinByCodeForm />
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-3">
            {publicRooms.length === 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">모집 중인 파티가 없습니다</CardTitle>
                  <CardDescription>
                    첫 번째 파티를 모집해보세요!
                  </CardDescription>
                </CardHeader>
                <CardContent />
              </Card>
            )}
            {publicRooms.map((room) => {
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
        </main>
        <FriendSidebar isGuest={isGuest} />
      </div>
    </>
  );
}
