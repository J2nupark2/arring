"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col items-center justify-center gap-5 px-6 text-center">
      <div>
        <h1 className="text-2xl font-bold">화면을 불러오지 못했습니다</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          잠시 후 다시 시도해주세요. 매칭 중이었다면 대기 상태는 서버에 유지됩니다.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={reset}>
          <RotateCcw className="size-4" />
          다시 시도
        </Button>
        <Button variant="outline" asChild>
          <Link href="/">홈으로</Link>
        </Button>
      </div>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">오류 번호: {error.digest}</p>
      ) : null}
    </main>
  );
}
