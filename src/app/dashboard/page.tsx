import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/app-header";
import { CreateRoomForm, JoinByCodeForm } from "@/components/room-forms";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; welcome?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/guest");
  }

  const { error, welcome } = await searchParams;
  const isGuest = user.is_anonymous ?? false;

  const { data: profile } = await supabase
    .from("profiles")
    .select("nickname, server")
    .eq("id", user.id)
    .single();

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">대시보드</h1>
          <p className="text-sm text-muted-foreground">
            {profile?.nickname ?? user.email ?? "게스트"}
            {profile?.server && ` (${profile.server})`}님, 환영합니다.
          </p>
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
            <CardTitle>새 통화방 만들기</CardTitle>
            <CardDescription>
              방 제목을 정하고 파티원에게 코드를 공유하세요.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CreateRoomForm
              titlePlaceholder="예: 불의 신전 4인팟"
              submitLabel="만들기"
            />
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
        <Card>
          <CardHeader>
            <CardTitle>친구 목록</CardTitle>
            <CardDescription>
              {isGuest
                ? "친구 추가는 회원가입 후 이용할 수 있어요. 친구 요청/수락 기능은 Phase 2에서 연결됩니다."
                : "친구 요청/수락 기능은 Phase 2에서 연결됩니다."}
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
      </main>
    </>
  );
}
