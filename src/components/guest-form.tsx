"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function GuestForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";

  const [nickname, setNickname] = useState("");
  const [server, setServer] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || !nickname.trim()) return;
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInAnonymously({
      options: { data: { nickname: nickname.trim(), server: server.trim() || null } },
    });

    if (signInError) {
      setError(
        signInError.message.includes("Anonymous sign-ins are disabled")
          ? "게스트 입장이 아직 활성화되지 않았습니다. 회원가입을 이용해주세요."
          : "게스트 입장에 실패했습니다: " + signInError.message,
      );
      setPending(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor="nickname">닉네임</Label>
          <Input
            id="nickname"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="아이온2 캐릭터명"
            maxLength={20}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="server">서버</Label>
          <Input
            id="server"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="예: 지켈"
            maxLength={20}
          />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending && <Loader2 className="animate-spin" />}
        {pending ? "입장 중..." : "바로 시작하기"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        계정이 있으신가요?{" "}
        <Link href="/login" className="underline underline-offset-4">
          로그인
        </Link>{" "}
        ·{" "}
        <Link href="/signup" className="underline underline-offset-4">
          회원가입
        </Link>
      </p>
    </form>
  );
}
