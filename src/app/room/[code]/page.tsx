import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { LinkButton } from "@/components/link-button";
import { CopyInvite } from "@/components/room/copy-invite";
import { VoiceRoom } from "@/components/room/voice-room";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/guest?next=${encodeURIComponent(`/room/${code}`)}`);
  }

  const { data: room } = await supabase
    .from("rooms")
    .select("id, code, title, max_members, status, expires_at, created_by, host_id")
    .eq("code", code)
    .maybeSingle();

  const isExpired = room && new Date(room.expires_at).getTime() < Date.now();
  const isInvalid = !room || room.status === "ended" || isExpired;

  if (isInvalid) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center sm:px-6">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>통화방을 찾을 수 없습니다</CardTitle>
              <CardDescription>
                존재하지 않거나 만료된 통화방 코드예요. 대시보드에서 새 통화방을
                만들어보세요.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <LinkButton href="/dashboard" variant="outline">
                대시보드로 이동
              </LinkButton>
            </CardContent>
          </Card>
        </main>
      </>
    );
  }

  const { data: memberCount } = await supabase.rpc("room_member_count", {
    target_room_id: room.id,
  });

  // A user already counted as active (e.g. rejoining after a refresh or a
  // closed tab that never recorded the leave) must not be blocked by the
  // member cap — they ARE one of the counted members.
  const { data: ownActiveRow } = await supabase
    .from("room_participants")
    .select("id")
    .eq("room_id", room.id)
    .eq("user_id", user.id)
    .is("left_at", null)
    .limit(1)
    .maybeSingle();

  if (
    !ownActiveRow &&
    typeof memberCount === "number" &&
    memberCount >= room.max_members
  ) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center sm:px-6">
          <Card className="w-full">
            <CardHeader>
              <CardTitle>정원이 가득 찼습니다</CardTitle>
              <CardDescription>
                {room.title} ({memberCount}/{room.max_members}명) — 자리가 나면
                다시 시도해주세요.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <LinkButton href="/party" variant="outline">
                다른 파티 찾기
              </LinkButton>
            </CardContent>
          </Card>
        </main>
      </>
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("nickname, server")
    .eq("id", user.id)
    .single();

  const displayName = profile
    ? profile.server
      ? `${profile.nickname} (${profile.server})`
      : profile.nickname
    : (user.email ?? "익명");

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-6 px-4 py-10 sm:px-6 sm:py-16">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>{room.title}</CardTitle>
            <CardDescription>
              방 코드{" "}
              <span className="font-mono font-semibold text-violet-300">
                {room.code}
              </span>{" "}
              — 코드나 링크를 공유하면 파티원이 바로 들어올 수 있어요.
            </CardDescription>
            <div className="pt-2">
              <CopyInvite code={room.code} />
            </div>
          </CardHeader>
          <CardContent>
            <VoiceRoom
              roomCode={room.code}
              roomId={room.id}
              userId={user.id}
              nickname={displayName}
              maxMembers={room.max_members}
              initialHostId={room.host_id ?? room.created_by}
              isGuest={user.is_anonymous ?? false}
            />
          </CardContent>
        </Card>
      </main>
    </>
  );
}
