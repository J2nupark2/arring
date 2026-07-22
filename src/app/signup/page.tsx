import Link from "next/link";
import { signup } from "./actions";
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

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24 sm:px-6">
      <Link href="/" className="arring-wordmark text-2xl">
        Arring
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>회원가입</CardTitle>
          <CardDescription>
            이메일과 비밀번호로 계정을 만든 뒤, 프로필에서 아이온2 캐릭터를 연동해주세요.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={signup} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="emailConfirmation">이메일 확인</Label>
              <Input
                id="emailConfirmation"
                name="emailConfirmation"
                type="email"
                placeholder="위 이메일을 한 번 더 입력"
                autoComplete="off"
                required
              />
              <p className="text-xs text-muted-foreground">
                브라우저 자동완성으로 다른 주소가 들어가는 일을 막기 위해 한 번 더 확인합니다.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password"
                name="password"
                type="password"
                minLength={8}
                autoComplete="new-password"
                required
              />
            </div>
            <label className="flex items-start gap-3 rounded-md border bg-muted/20 p-3 text-sm leading-relaxed">
              <input
                type="checkbox"
                name="evaluationConsent"
                value="accepted"
                required
                className="mt-1 size-4 shrink-0 accent-primary"
              />
              <span>
                아링을 통해 매칭이 된 후에는 함께 플레이한 이용자 간 평가가 오갈 수 있으며,
                이 평가 정보는 매칭과 프로필 화면 등 사이트를 이용하는 다른 사람에게도
                표시될 수 있음에 동의합니다.
              </span>
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <SubmitButton pendingText="가입 처리 중..." className="w-full">
              회원가입
            </SubmitButton>
            <p className="text-center text-sm text-muted-foreground">
              이미 계정이 있으신가요?{" "}
              <Link href="/login" className="underline underline-offset-4">
                로그인
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
