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

// Shared entry screen used by both "/" (first visit) and "/guest"
// (redirected here from a protected page). Nickname-only guest entry with
// login/signup as the alternative path.
export function GuestEntryCard({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? "flex w-full items-center justify-center"
          : "flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24 sm:px-6"
      }
    >
      {!compact && (
        <Link
          href="/"
          className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-2xl font-bold tracking-tight text-transparent"
        >
          Arring
        </Link>
      )}
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>닉네임으로 바로 시작하기</CardTitle>
          <CardDescription>
            아이온2 던전 파티 통화방. 닉네임만 입력하면 계정 없이 바로
            이용할 수 있어요. 친구 추가 등 계정 기능은 로그인 후
            이용하실 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense>
            <GuestForm />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
