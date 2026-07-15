import Link from "next/link";
import { updatePassword } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24 sm:px-6">
      <Link href="/" className="text-2xl font-bold text-violet-300">Arring</Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>새 비밀번호 설정</CardTitle>
          <CardDescription>앞으로 사용할 새 비밀번호를 입력해주세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updatePassword} className="flex flex-col gap-4">
            <div className="grid gap-2">
              <Label htmlFor="password">새 비밀번호</Label>
              <Input id="password" name="password" type="password" minLength={6} autoComplete="new-password" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirmation">새 비밀번호 확인</Label>
              <Input id="confirmation" name="confirmation" type="password" minLength={6} autoComplete="new-password" required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <SubmitButton pendingText="변경 중..." className="w-full">비밀번호 변경</SubmitButton>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
