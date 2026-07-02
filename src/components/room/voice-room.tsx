"use client";

import { useRouter } from "next/navigation";
import { useVoiceRoom } from "@/hooks/use-voice-room";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Mic, MicOff, PhoneOff } from "lucide-react";

export function VoiceRoom({
  roomCode,
  roomId,
  userId,
  nickname,
}: {
  roomCode: string;
  roomId: string;
  userId: string;
  nickname: string;
}) {
  const router = useRouter();
  const { participants, muted, toggleMute, status } = useVoiceRoom({
    roomCode,
    roomId,
    userId,
    nickname,
  });

  return (
    <div className="flex w-full flex-col gap-6">
      {status === "connecting" && (
        <p className="text-sm text-muted-foreground">
          마이크에 연결하는 중...
        </p>
      )}
      {status === "error" && (
        <p className="text-sm text-destructive">
          마이크 권한이 필요합니다. 브라우저 설정에서 마이크 권한을 허용해주세요.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {participants.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between rounded-md border px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <Avatar className="size-7">
                <AvatarFallback>{p.nickname.slice(0, 1)}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium">
                {p.nickname}
                {p.isSelf && " (나)"}
              </span>
            </div>
            {p.muted ? (
              <MicOff className="size-4 text-muted-foreground" />
            ) : (
              <Mic className="size-4 text-muted-foreground" />
            )}
          </li>
        ))}
      </ul>

      <div className="flex justify-center gap-3">
        <Button
          variant={muted ? "default" : "outline"}
          size="icon-lg"
          onClick={toggleMute}
          aria-label={muted ? "음소거 해제" : "음소거"}
        >
          {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
        </Button>
        <Button
          variant="destructive"
          size="icon-lg"
          onClick={() => router.push("/dashboard")}
          aria-label="퇴장"
        >
          <PhoneOff className="size-5" />
        </Button>
      </div>
    </div>
  );
}
