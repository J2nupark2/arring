import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createRoom } from "@/app/dashboard/actions";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/link-button";
import { PartyRefresh } from "@/components/party-refresh";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?error=${encodeURIComponent("로그인 후 파티를 구할 수 있습니다.")}`);
  }

  const { error } = await searchParams;
  const { data: rooms } = await supabase.rpc("list_public_rooms");
  const publicRooms = (rooms ?? []) as PublicRoom[];

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">파티 구하기</h1>
          <p className="text-sm text-muted-foreground">
            모집 중인 파티에 바로 입장하거나, 직접 파티를 모집해보세요.
          </p>
        </div>
        <PartyRefresh />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>파티 모집하기</CardTitle>
          <CardDescription>
            모집글을 올리면 공개 통화방이 만들어지고 이 목록에 노출됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createRoom} className="flex flex-wrap gap-2">
            <input type="hidden" name="isPublic" value="on" />
            <Input
              name="title"
              placeholder="예: 불의 신전 스피드런, 딜러 2명 구해요"
              maxLength={40}
              required
              className="min-w-48 flex-1"
            />
            <Input
              name="maxMembers"
              type="number"
              min={2}
              max={12}
              defaultValue={6}
              className="w-24"
              aria-label="최대 인원"
            />
            <SubmitButton pendingText="만드는 중...">모집 시작</SubmitButton>
          </form>
        </CardContent>
      </Card>

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
                  <span className="truncate font-medium">{room.title}</span>
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
    </>
  );
}
