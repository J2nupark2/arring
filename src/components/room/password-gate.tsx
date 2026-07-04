"use client";

import { useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function PasswordGate({
  roomId,
  roomTitle,
  skip,
  children,
}: {
  roomId: string;
  roomTitle: string;
  skip: boolean;
  children: React.ReactNode;
}) {
  const [unlocked, setUnlocked] = useState(skip);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (unlocked) return <>{children}</>;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc(
      "verify_room_password",
      { target_room_id: roomId, password },
    );

    if (rpcError) {
      setError("확인에 실패했습니다: " + rpcError.message);
      setPending(false);
      return;
    }

    if (!data) {
      setError("비밀번호가 올바르지 않습니다.");
      setPending(false);
      return;
    }

    setUnlocked(true);
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="size-4.5" />
          {roomTitle}
        </CardTitle>
        <CardDescription>비밀번호가 걸린 통화방입니다.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            autoFocus
            required
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {pending ? "확인 중..." : "입장"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
