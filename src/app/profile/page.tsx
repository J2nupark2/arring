import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { LinkButton } from "@/components/link-button";
import { Aion2LinkCard } from "@/components/profile/aion2-link-card";
import { DeleteAccountCard } from "@/components/profile/delete-account-card";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.is_anonymous) {
    redirect(`/login?next=${encodeURIComponent("/profile")}`);
  }

  const [{ data: profile }, { data: characters }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "nickname, server, char_class, combat_power, aion2_character_id, aion2_character_name, aion2_server_id, aion2_synced_at",
      )
      .eq("id", user.id)
      .single(),
    supabase
      .from("aion2_characters")
      .select(
        "id, character_id, character_name, server_id, server_name, class_name, character_level, combat_power, is_primary, synced_at",
      )
      .eq("user_id", user.id)
      .order("is_primary", { ascending: false })
      .order("synced_at", { ascending: false }),
  ]);

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">내 프로필</h1>
            <p className="text-sm text-muted-foreground">
              아이온2 캐릭터 연동과 플레이 기록을 관리할 수 있어요.
            </p>
          </div>
          <LinkButton href="/profile/history" variant="outline">
            플레이 기록
          </LinkButton>
        </div>
        <Aion2LinkCard
          characters={(characters ?? []).map((character) => ({
            id: character.id,
            characterId: character.character_id,
            characterName: character.character_name,
            serverId: character.server_id,
            server: character.server_name,
            charClass: character.class_name,
            level: character.character_level,
            combatPower: character.combat_power,
            isPrimary: character.is_primary,
            syncedAt: character.synced_at,
          }))}
          linked={
            profile?.aion2_character_id
              ? {
                  characterId: profile.aion2_character_id,
                  characterName: profile.aion2_character_name ?? "",
                  serverId: profile.aion2_server_id ?? 0,
                  server: profile.server ?? "",
                  charClass: profile.char_class ?? "",
                  combatPower: profile.combat_power ?? 0,
                  syncedAt: profile.aion2_synced_at,
                }
              : null
          }
        />
        <DeleteAccountCard />
      </main>
    </>
  );
}
