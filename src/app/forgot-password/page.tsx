import Link from "next/link";
import { requestPasswordReset } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; email?: string }>;
}) {
  const { error, sent, email } = await searchParams;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24 sm:px-6">
      <Link href="/" className="text-2xl font-bold text-violet-300">Arring</Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>비밀번호 찾기</CardTitle>
          <CardDescription>
            가입한 이메일로 비밀번호 재설정 링크를 보내드립니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4 text-sm">
              <p className="leading-6 text-muted-foreground">
                {email ?? "입력한 이메일"}로 재설정 링크를 보냈습니다. 메일함과 스팸함을 확인해주세요.
              </p>
              <Link href="/login" className="block text-center font-medium underline underline-offset-4">
                로그인으로 돌아가기
              </Link>
            </div>
          ) : (
            <form action={requestPasswordReset} className="flex flex-col gap-4">
              <div className="grid gap-2">
                <Label htmlFor="email">이메일</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <SubmitButton pendingText="메일 전송 중..." className="w-full">
                재설정 메일 보내기
              </SubmitButton>
              <Link href="/login" className="text-center text-sm underline underline-offset-4">
                로그인으로 돌아가기
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
