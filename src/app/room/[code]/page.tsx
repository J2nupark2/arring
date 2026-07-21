import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { FriendSidebar } from "@/components/friends/friend-sidebar";
import { FriendsProvider } from "@/components/friends/friends-provider";
import { LinkButton } from "@/components/link-button";
import { PasswordGate } from "@/components/room/password-gate";
import { VoiceRoom } from "@/components/room/voice-room";
import { formatAion2InviteName } from "@/lib/aion2-invite";
import { getAion2ProfileImage } from "@/lib/aion2-profile-image";
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

  // getUser() and the room lookup don't depend on each other — running them
  // sequentially would waterfall two Supabase round trips for no reason.
  const [
    {
      data: { user },
    },
    { data: room },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("rooms")
      .select("id, code, title, max_members, status, expires_at, created_by, host_id")
      .eq("code", code)
      .maybeSingle(),
  ]);

  if (!user || user.is_anonymous) {
    redirect(`/login?next=${encodeURIComponent(`/room/${code}`)}`);
  }

  // eslint-disable-next-line react-hooks/purity -- Server Component request-time expiry check.
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
                존재하지 않거나 만료된 통화방 코드예요. 매치 메이킹에서 새
                통화방을 만들어보세요.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <LinkButton href="/party" variant="outline">
                매치 메이킹으로 이동
              </LinkButton>
            </CardContent>
          </Card>
        </main>
      </>
    );
  }

  // These reads are independent, so keep them off the room render waterfall.
  // room_has_password is fetched unconditionally (even though its result is
  // discarded when skipPasswordGate ends up true) to keep it out of the
  // critical path — it's a cheap SECURITY DEFINER read either way.
  const [
    { data: memberCount },
    { data: ownActiveRow },
    { data: ownLeftRow },
    { data: profile },
    { data: hasPasswordRaw },
    { data: ownQueueMatch },
    { data: ownLeaderMatch },
    { data: ownCharacters },
    { data: ownKick },
  ] = await Promise.all([
    supabase.rpc("room_member_count", { target_room_id: room.id }),
    // A user already counted as active (e.g. rejoining after a refresh or a
    // closed tab that never recorded the leave) must not be blocked by the
    // member cap — they ARE one of the counted members.
    supabase
      .from("room_participants")
      .select("id")
      .eq("room_id", room.id)
      .eq("user_id", user.id)
      .is("left_at", null)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("room_participants")
      .select("id")
      .eq("room_id", room.id)
      .eq("user_id", user.id)
      .not("left_at", "is", null)
      .limit(1)
      .maybeSingle(),
    supabase.from("profiles").select("nickname, server").eq("id", user.id).single(),
    supabase.rpc("room_has_password", { target_room_id: room.id }),
    supabase
      .from("match_queue")
      .select("character_row_id")
      .eq("room_id", room.id)
      .eq("user_id", user.id)
      .eq("status", "matched")
      .order("matched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("match_requests")
      .select("character_row_id")
      .eq("room_id", room.id)
      .eq("leader_id", user.id)
      .eq("status", "matched")
      .order("matched_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("aion2_characters")
      .select("id, class_name, detail_data")
      .eq("user_id", user.id)
      .order("is_primary", { ascending: false })
      .order("synced_at", { ascending: false }),
    supabase
      .from("room_kicks")
      .select("target_id")
      .eq("room_id", room.id)
      .eq("target_id", user.id)
      .maybeSingle(),
  ]);

  if (ownKick) {
    redirect(
      "/party?error=" + encodeURIComponent("방장에 의해 추방된 방에는 다시 입장할 수 없습니다."),
    );
  }

  if (!ownActiveRow && ownLeftRow) {
    redirect(
      "/party?error=" + encodeURIComponent("이미 나간 방에는 다시 입장할 수 없습니다."),
    );
  }

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

  const displayName = profile
    ? profile.server
      ? `${profile.nickname} (${profile.server})`
      : profile.nickname
    : (user.email ?? "익명");
  const inviteName = formatAion2InviteName(
    profile?.nickname ?? user.email ?? "익명",
    profile?.server,
  );
  const characterRows = (ownCharacters ?? []) as {
    id: string;
    class_name: string | null;
    detail_data: unknown;
  }[];
  const matchedCharacterRowId =
    (ownQueueMatch as { character_row_id: string | null } | null)
      ?.character_row_id ??
    (ownLeaderMatch as { character_row_id: string | null } | null)
      ?.character_row_id ??
    null;
  const roomCharacter =
    characterRows.find((character) => character.id === matchedCharacterRowId) ??
    characterRows[0] ??
    null;

  // Already-joined participants and the room's creator never need to
  // re-enter the password.
  const skipPasswordGate = !!ownActiveRow || room.created_by === user.id;
  const hasPassword = !!hasPasswordRaw;

  const isGuest = false;

  return (
    <FriendsProvider isGuest={isGuest}>
      <AppHeader showFriends isGuest={isGuest} currentRoomCode={room.code} />
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4 py-10 sm:px-6 sm:py-16">
        <main className="flex min-w-0 flex-1 flex-col items-center justify-center">
          <PasswordGate
            roomId={room.id}
            roomTitle={room.title}
            skip={skipPasswordGate || !hasPassword}
          >
            <Card className="w-full max-w-lg">
              <CardHeader>
                <CardTitle>{room.title}</CardTitle>
                <CardDescription>
                  매칭이 완료된 파티원만 참여하는 통화방입니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <VoiceRoom
                  roomCode={room.code}
                  roomId={room.id}
                  userId={user.id}
                  nickname={displayName}
                  inviteName={inviteName}
                  maxMembers={room.max_members}
                  initialHostId={room.host_id ?? room.created_by}
                  initialCharacterRowId={roomCharacter?.id ?? null}
                  initialClassName={roomCharacter?.class_name ?? null}
                  initialProfileImageUrl={getAion2ProfileImage(
                    roomCharacter?.detail_data,
                  )}
                  isGuest={isGuest}
                />
              </CardContent>
            </Card>
          </PasswordGate>
        </main>
        <FriendSidebar isGuest={isGuest} currentRoomCode={room.code} />
      </div>
    </FriendsProvider>
  );
}
