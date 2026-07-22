import Link from "next/link";
import { resendSignupEmail } from "../actions";
import { SubmitButton } from "@/components/submit-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; error?: string; resent?: string }>;
}) {
  const { email, error, resent } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-24">
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle>이메일을 확인해주세요</CardTitle>
          <CardDescription>
            {email ? <span className="font-medium text-primary">{email}</span> : "가입하신 이메일"}로
            인증 메일을 보냈습니다. 메일함에서 링크를 클릭하면 가입이 완료됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {resent && (
            <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-primary">
              인증 메일을 다시 보냈습니다. 메일함과 스팸함을 확인해주세요.
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {email && (
            <form action={resendSignupEmail}>
              <input type="hidden" name="email" value={email} />
              <SubmitButton pendingText="재발송 중..." variant="outline" className="w-full">
                인증 메일 다시 보내기
              </SubmitButton>
            </form>
          )}
          <Link href="/signup" className="text-sm text-muted-foreground underline underline-offset-4">
            이메일을 잘못 입력했다면 다시 가입하기
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
