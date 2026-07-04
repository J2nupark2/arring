"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { generateRoomCode } from "@/lib/room-code";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const ROOM_TTL_HOURS = 6;
const MIN_MEMBERS = 2;
const MAX_MEMBERS = 12;

// Creates the room straight from the browser (Korea → Supabase) instead of
// routing through the US serverless function — skips its latency and cold
// starts entirely.
export function CreateRoomForm({
  isPublic = false,
  showMaxMembers = false,
  titlePlaceholder,
  submitLabel,
}: {
  isPublic?: boolean;
  showMaxMembers?: boolean;
  titlePlaceholder: string;
  submitLabel: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [maxMembers, setMaxMembers] = useState(6);
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
      router.push("/login");
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
      const { error: insertError } = await supabase.from("rooms").insert({
        code,
        title: title.trim() || "파티 통화방",
        max_members: clampedMax,
        is_public: isPublic,
        created_by: session.user.id,
        host_id: session.user.id,
        expires_at: expiresAt,
      });

      if (!insertError) {
        router.push(`/room/${code}`);
        return;
      }

      // 23505 = unique_violation on the room code — retry with a fresh code.
      if (insertError.code !== "23505") {
        setError("통화방 생성에 실패했습니다: " + insertError.message);
        setPending(false);
        return;
      }
    }

    setError("통화방 코드 생성에 실패했습니다. 다시 시도해주세요.");
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={titlePlaceholder}
          maxLength={40}
          required={isPublic}
          className="min-w-40 flex-1"
        />
        {showMaxMembers && (
          <Input
            type="number"
            min={MIN_MEMBERS}
            max={MAX_MEMBERS}
            value={maxMembers}
            onChange={(e) => setMaxMembers(Number(e.target.value))}
            className="w-20"
            aria-label="최대 인원"
          />
        )}
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          {pending ? "만드는 중..." : submitLabel}
        </Button>
      </div>
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
