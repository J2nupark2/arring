"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useVoiceRoom } from "@/hooks/use-voice-room";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Crown,
  Loader2,
  Mic,
  MicOff,
  MoreVertical,
  PhoneOff,
  UserX,
  Volume2,
} from "lucide-react";

export function VoiceRoom({
  roomCode,
  roomId,
  userId,
  nickname,
  maxMembers,
  initialHostId,
}: {
  roomCode: string;
  roomId: string;
  userId: string;
  nickname: string;
  maxMembers: number;
  initialHostId: string;
}) {
  const router = useRouter();
  const [leaving, startLeaving] = useTransition();
  const {
    participants,
    muted,
    toggleMute,
    micGain,
    setMicGain,
    volumes,
    setParticipantVolume,
    hostId,
    isHost,
    transferHost,
    kickParticipant,
    status,
  } = useVoiceRoom({
    roomCode,
    roomId,
    userId,
    nickname,
    initialHostId,
    onKicked: () =>
      router.push(
        "/dashboard?error=" + encodeURIComponent("방장에 의해 추방되었습니다."),
      ),
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

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>참가자</span>
        <span>
          {participants.length}/{maxMembers}명
        </span>
      </div>

      <ul className="flex flex-col gap-2">
        {participants.map((p) => (
          <li key={p.id} className="flex flex-col gap-2 rounded-md border px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Avatar className="size-7">
                  <AvatarFallback>{p.nickname.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <span className="flex items-center gap-1 text-sm font-medium">
                  {p.id === hostId && (
                    <Crown className="size-4 text-amber-500" aria-label="방장" />
                  )}
                  {p.nickname}
                  {p.isSelf && " (나)"}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {p.muted ? (
                  <MicOff className="size-4 text-muted-foreground" />
                ) : (
                  <Mic className="size-4 text-muted-foreground" />
                )}
                {isHost && !p.isSelf && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${p.nickname} 관리`}
                      >
                        <MoreVertical className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => transferHost(p.id)}>
                        <Crown className="size-4" />
                        방장 위임
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => kickParticipant(p.id)}
                      >
                        <UserX className="size-4" />
                        추방
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
            {!p.isSelf && (
              <div className="flex items-center gap-2">
                <Volume2 className="size-4 shrink-0 text-muted-foreground" />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round((volumes[p.id] ?? 1) * 100)}
                  onChange={(e) =>
                    setParticipantVolume(p.id, Number(e.target.value) / 100)
                  }
                  className="h-1.5 w-full cursor-pointer accent-primary"
                  aria-label={`${p.nickname} 소리 크기`}
                />
                <span className="w-9 shrink-0 text-right text-xs text-muted-foreground">
                  {Math.round((volumes[p.id] ?? 1) * 100)}%
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2 rounded-md border px-3 py-2">
        <Mic className="size-4 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-sm">내 마이크 음량</span>
        <input
          type="range"
          min={0}
          max={200}
          value={Math.round(micGain * 100)}
          onChange={(e) => setMicGain(Number(e.target.value) / 100)}
          className="h-1.5 w-full cursor-pointer accent-primary"
          aria-label="내 마이크 음량"
        />
        <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
          {Math.round(micGain * 100)}%
        </span>
      </div>

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
          disabled={leaving}
          onClick={() => startLeaving(() => router.push("/dashboard"))}
          aria-label="퇴장"
        >
          {leaving ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <PhoneOff className="size-5" />
          )}
        </Button>
      </div>
    </div>
  );
}
