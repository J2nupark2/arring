import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("nickname")
    .eq("id", user.id)
    .single();

  return (
    <div className="mx-auto flex max-w-5xl flex-1 flex-col gap-6 px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">대시보드</h1>
          <p className="text-sm text-muted-foreground">
            {profile?.nickname ?? user.email}님, 환영합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button disabled>통화방 만들기 (준비 중)</Button>
          <form action={logout}>
            <Button type="submit" variant="ghost">
              로그아웃
            </Button>
          </form>
        </div>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>내 통화방</CardTitle>
            <CardDescription>
              생성/참여 중인 통화방 목록이 곧 이곳에 표시됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent />
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
