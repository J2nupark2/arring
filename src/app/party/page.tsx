import Link from "next/link";
import type { Dungeon } from "@/lib/aion2";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { FriendSidebar } from "@/components/friends/friend-sidebar";
import { FriendsProvider } from "@/components/friends/friends-provider";
import { MatchingPanel } from "@/components/matching-panel";
import { PartyRefresh } from "@/components/party-refresh";

export const dynamic = "force-dynamic";

export default async function PartyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; welcome?: string }>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isGuest = !user || user.is_anonymous === true;
  const { data: dungeons } = await supabase
    .from("dungeons")
    .select("id, category, name, gimmick_stages, tier, sort_order, is_active")
    .eq("is_active", true)
    .order("tier", { ascending: false })
    .order("category")
    .order("sort_order");

  let profile = null;
  let progress: { dungeon_id: string; stage: number }[] = [];
  let characters: {
    id: string;
    character_name: string;
    server_name: string;
    class_name: string;
    combat_power: number;
    is_primary: boolean;
  }[] = [];

  if (!isGuest && user) {
    const [profileResult, progressResult, characterResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("char_class, combat_power, manner_temperature, trust_temperature")
        .eq("id", user.id)
        .single(),
      supabase
        .from("dungeon_progress")
        .select("dungeon_id, stage")
        .eq("user_id", user.id),
      supabase
        .from("aion2_characters")
        .select("id, character_name, server_name, class_name, combat_power, is_primary")
        .eq("user_id", user.id)
        .order("is_primary", { ascending: false })
        .order("synced_at", { ascending: false }),
    ]);
    profile = profileResult.data;
    progress = progressResult.data ?? [];
    characters = characterResult.data ?? [];
  }

  const { error, welcome } = await searchParams;
  return (
    <FriendsProvider isGuest={isGuest}>
      <AppHeader showFriends isGuest={isGuest} />
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <main className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">매치 메이킹</h1>
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
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary">
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
        </main>
        <FriendSidebar isGuest={isGuest} />
      </div>
    </FriendsProvider>
  );
}
