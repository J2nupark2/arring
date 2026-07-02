import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/actions";
import { createRoom, joinRoomByCode } from "./actions";
import { LinkButton } from "@/components/link-button";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
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
    redirect("/login");
  }

  const { error, welcome } = await searchParams;

  const { data: profile } = await supabase
    .from("profiles")
    .select("nickname, server")
    .eq("id", user.id)
    .single();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">대시보드</h1>
          <p className="text-sm text-muted-foreground">
            {profile?.nickname ?? user.email}
            {profile?.server && ` (${profile.server})`}님, 환영합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LinkButton href="/party" variant="outline">
            파티 구하기
          </LinkButton>
          <form action={logout}>
            <SubmitButton pendingText="로그아웃 중..." variant="ghost">
              로그아웃
            </SubmitButton>
          </form>
        </div>
      </div>

      {welcome && (
        <div className="rounded-md border border-green-600/30 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-400">
          🎉 회원가입이 완료되었습니다! 이제 통화방을 만들어 파티원을 초대해보세요.
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
            <form action={createRoom} className="flex gap-2">
              <Input
                name="title"
                placeholder="예: 불의 신전 4인팟"
                maxLength={40}
              />
              <SubmitButton pendingText="만드는 중...">만들기</SubmitButton>
            </form>
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
            <form action={joinRoomByCode} className="flex gap-2">
              <Input
                name="code"
                placeholder="예: 7XQK2M"
                maxLength={6}
                className="uppercase"
                required
              />
              <SubmitButton pendingText="입장 중..." variant="outline">
                입장
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>친구 목록</CardTitle>
            <CardDescription>
              친구 요청/수락 기능은 Phase 2에서 연결됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    </div>
  );
}
