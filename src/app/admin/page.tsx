import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { DungeonManager } from "@/components/admin/dungeon-manager";
import { StatPriorityManager } from "@/components/admin/stat-priority-manager";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/guest?next=${encodeURIComponent("/admin")}`);
  }

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  if (!me?.is_admin) {
    redirect("/party");
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">관리자</h1>
          <p className="text-sm text-muted-foreground">
            매칭에 사용할 던전 목록과 기믹 진도 단계를 관리합니다.
          </p>
        </div>
        <DungeonManager />
        <StatPriorityManager />
      </main>
    </>
  );
}
