import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
    redirect(`/login?error=${encodeURIComponent("로그인 후 통화방에 입장할 수 있습니다.")}`);
  }

  const { data: room } = await supabase
    .from("rooms")
    .select("id, code, status, expires_at, created_by")
    .eq("code", code)
    .maybeSingle();

  const isExpired = room && new Date(room.expires_at).getTime() < Date.now();
  const isInvalid = !room || room.status === "ended" || isExpired;

  if (isInvalid) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-6 px-6 py-24 text-center">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>통화방을 찾을 수 없습니다</CardTitle>
            <CardDescription>
              존재하지 않거나 만료된 통화방 코드예요. 대시보드에서 새 통화방을
              만들어보세요.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
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
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-6 px-6 py-24">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>통화방 {room.code}</CardTitle>
          <CardDescription>
            같은 코드를 가진 파티원과 자동으로 음성 연결됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <VoiceRoom
            roomCode={room.code}
            roomId={room.id}
            userId={user.id}
            nickname={displayName}
          />
        </CardContent>
      </Card>
    </div>
  );
}
