import { Suspense } from "react";
import Link from "next/link";
import { GuestForm } from "@/components/guest-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function GuestPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24 sm:px-6">
      <Link
        href="/"
        className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-2xl font-bold tracking-tight text-transparent"
      >
        Arring
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>게스트로 시작하기</CardTitle>
          <CardDescription>
            닉네임만 입력하면 계정 없이 바로 통화방을 이용할 수 있어요. 친구
            추가 등 계정 기능은 나중에 회원가입으로 이용하실 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense>
            <GuestForm />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
