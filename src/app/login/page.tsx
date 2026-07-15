import Link from "next/link";
import { login } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; passwordUpdated?: string }>;
}) {
  const { error, next, passwordUpdated } = await searchParams;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24 sm:px-6">
      <Link
        href="/"
        className="arring-wordmark text-2xl"
      >
        Arring
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>로그인</CardTitle>
          <CardDescription>계정으로 로그인해야 서비스를 이용할 수 있어요.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={login} className="flex flex-col gap-4">
            <input type="hidden" name="next" value={next ?? "/party"} />
            <div className="grid gap-2">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="password">비밀번호</Label>
                <Link href="/forgot-password" className="text-xs text-muted-foreground underline underline-offset-4">
                  비밀번호 찾기
                </Link>
              </div>
              <Input id="password" name="password" type="password" required />
            </div>
            {passwordUpdated && (
              <p className="text-sm text-emerald-400">비밀번호가 변경되었습니다. 다시 로그인해주세요.</p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <SubmitButton pendingText="로그인 중..." className="w-full">
              로그인
            </SubmitButton>
            <p className="text-center text-sm text-muted-foreground">
              계정이 없으신가요?{" "}
              <Link href="/signup" className="underline underline-offset-4">
                회원가입
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
