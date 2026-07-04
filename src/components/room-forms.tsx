"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { generateRoomCode } from "@/lib/room-code";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

const ROOM_TTL_HOURS = 6;
const MIN_MEMBERS = 2;
const MAX_MEMBERS = 12;

// Creates the room straight from the browser (Korea → Supabase) via the
// create_room RPC — skips the US serverless function's latency/cold starts,
// and lets the password (if any) get bcrypt-hashed server-side without ever
// leaving the client in plaintext form beyond this one call.
export function CreateRoomForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [maxMembers, setMaxMembers] = useState(6);
  const [isPublic, setIsPublic] = useState(true);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      router.push("/");
      return;
    }

    const clampedMax = Math.min(
      Math.max(Math.trunc(maxMembers) || 6, MIN_MEMBERS),
      MAX_MEMBERS,
    );
    const expiresAt = new Date(
      Date.now() + ROOM_TTL_HOURS * 60 * 60 * 1000,
    ).toISOString();

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateRoomCode();
      const { error: rpcError } = await supabase.rpc("create_room", {
        p_code: code,
        p_title: title.trim() || "파티 통화방",
        p_max_members: clampedMax,
        p_is_public: isPublic,
        p_password: password.trim() || null,
        p_expires_at: expiresAt,
      });

      if (!rpcError) {
        router.push(`/room/${code}`);
        return;
      }

      // 23505 = unique_violation on the room code — retry with a fresh code.
      if (rpcError.code !== "23505") {
        setError("통화방 생성에 실패했습니다: " + rpcError.message);
        setPending(false);
        return;
      }
    }

    setError("통화방 코드 생성에 실패했습니다. 다시 시도해주세요.");
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="예: 불의 신전 4인팟"
          maxLength={40}
          className="min-w-40 flex-1"
        />
        <Input
          type="number"
          min={MIN_MEMBERS}
          max={MAX_MEMBERS}
          value={maxMembers}
          onChange={(e) => setMaxMembers(Number(e.target.value))}
          className="w-20"
          aria-label="최대 인원"
        />
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          {isPublic ? "파티 목록에 공개" : "비공개 (코드로만 입장)"}
        </label>
        <div className="flex min-w-40 flex-1 items-center gap-2">
          <Lock className="size-4 shrink-0 text-muted-foreground" />
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호 (선택)"
            maxLength={40}
          />
        </div>
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {pending && <Loader2 className="animate-spin" />}
        {pending ? "만드는 중..." : "통화방 만들기"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}

export function JoinByCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!normalized || pending) return;
    setPending(true);
    router.push(`/room/${normalized}`);
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="예: 7XQK2M"
        maxLength={6}
        className="uppercase"
        required
        aria-label="통화방 코드"
      />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        {pending ? "입장 중..." : "입장"}
      </Button>
    </form>
  );
}
