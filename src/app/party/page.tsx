import Link from "next/link";
import { redirect } from "next/navigation";
import type { Dungeon } from "@/lib/aion2";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { FriendSidebar } from "@/components/friends/friend-sidebar";
import { FriendsProvider } from "@/components/friends/friends-provider";
import { MatchingPanel } from "@/components/matching-panel";
import { PartyRefresh } from "@/components/party-refresh";
import { PartyRoomList } from "@/components/party-room-list";
import { CreateRoomForm, JoinByCodeForm } from "@/components/room-forms";
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

export default async function PartyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; welcome?: string }>;
}) {
  const supabase = await createClient();

  // list_public_rooms() doesn't depend on the caller's identity, so fetch
  // it alongside getUser() instead of waterfalling two round trips.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/guest?next=${encodeURIComponent("/party")}`);
  }

  const [
    { data: rooms },
    { data: dungeons },
    { data: profile },
    { data: progress },
    { data: characters },
  ] =
    await Promise.all([
      supabase.rpc("list_public_rooms"),
      supabase
        .from("dungeons")
        .select("id, category, name, gimmick_stages, sort_order, is_active")
        .eq("is_active", true)
        .order("category")
        .order("sort_order"),
      supabase
        .from("profiles")
        .select(
          "char_class, combat_power, manner_temperature, trust_temperature",
        )
        .eq("id", user.id)
        .single(),
      supabase
        .from("dungeon_progress")
        .select("dungeon_id, stage")
        .eq("user_id", user.id),
      supabase
        .from("aion2_characters")
        .select(
          "id, character_name, server_name, class_name, combat_power, is_primary",
        )
        .eq("user_id", user.id)
        .order("is_primary", { ascending: false })
        .order("synced_at", { ascending: false }),
    ]);

  const { error, welcome } = await searchParams;
  const isGuest = user.is_anonymous ?? false;
  const publicRooms = (rooms ?? []) as PublicRoom[];

  return (
    <FriendsProvider isGuest={isGuest}>
      <AppHeader showFriends isGuest={isGuest} />
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <main className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">파티 구하기</h1>
              <p className="text-sm text-muted-foreground">
                조건과 진도를 기준으로 자동매칭하고, 방장은 마이크로 리딩합니다.
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

          <MatchingPanel
            dungeons={(dungeons ?? []) as Dungeon[]}
            profile={
              profile
                ? {
                    charClass: profile.char_class,
                    combatPower: profile.combat_power,
                    mannerTemperature: profile.manner_temperature,
                    trustTemperature: profile.trust_temperature,
                  }
                : null
            }
            progress={(progress ?? []).map((item) => ({
              dungeonId: item.dungeon_id,
              stage: item.stage,
            }))}
            characters={(characters ?? []).map((character) => ({
              id: character.id,
              name: character.character_name,
              server: character.server_name,
              className: character.class_name,
              combatPower: character.combat_power,
              isPrimary: character.is_primary,
            }))}
            isGuest={isGuest}
          />

          <div className="grid gap-6 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>수동 통화방 만들기</CardTitle>
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

          <PartyRoomList rooms={publicRooms} />
        </main>
        <FriendSidebar isGuest={isGuest} />
      </div>
    </FriendsProvider>
  );
}
