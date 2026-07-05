"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useVoiceRoom } from "@/hooks/use-voice-room";
import { sendFriendRequest } from "@/hooks/use-friends";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Send,
  UserPlus,
  UserX,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function VoiceRoom({
  roomCode,
  roomId,
  userId,
  nickname,
  maxMembers,
  initialHostId,
  isGuest = false,
}: {
  roomCode: string;
  roomId: string;
  userId: string;
  nickname: string;
  maxMembers: number;
  initialHostId: string;
  isGuest?: boolean;
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
    speaking,
    hostId,
    isHost,
    transferHost,
    kickParticipant,
    status,
    chatMessages,
    sendChatMessage,
  } = useVoiceRoom({
    roomCode,
    roomId,
    userId,
    nickname,
    initialHostId,
    onKicked: () => {
      router.push(
        "/party?error=" + encodeURIComponent("방장에 의해 추방되었습니다."),
      );
      router.refresh();
    },
  });
  const [chatText, setChatText] = useState("");
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ block: "end" });
  }, [chatMessages.length]);

  function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatText.trim()) return;
    sendChatMessage(chatText);
    setChatText("");
  }

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
                <Avatar
                  className={`size-7 transition-shadow ${
                    speaking[p.id]
                      ? "ring-2 ring-green-500 ring-offset-2 ring-offset-card"
                      : ""
                  }`}
                >
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
                {!p.isSelf && !isGuest && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${p.nickname} 친구 추가`}
                    onClick={() => sendFriendRequest(p.id)}
                  >
                    <UserPlus className="size-4" />
                  </Button>
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

      <div className="flex flex-col gap-2">
        <span className="text-sm text-muted-foreground">채팅</span>
        <div className="flex h-48 flex-col gap-2 overflow-y-auto rounded-md border p-3">
          {chatMessages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              아직 채팅이 없어요. 파티원에게 인사해보세요!
            </p>
          )}
          {chatMessages.map((m) => {
            const isMine = m.userId === userId;
            return (
              <div
                key={m.id}
                className={cn("flex", isMine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[80%] rounded-lg px-3 py-1.5 text-sm break-words",
                    isMine
                      ? "bg-violet-600 text-white"
                      : "bg-muted text-foreground",
                  )}
                >
                  {!isMine && (
                    <div className="text-xs font-medium opacity-70">
                      {m.nickname}
                    </div>
                  )}
                  {m.body}
                </div>
              </div>
            );
          })}
          <div ref={chatBottomRef} />
        </div>
        <form onSubmit={handleSendChat} className="flex gap-2">
          <Input
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder="메시지 입력..."
            maxLength={500}
            aria-label="통화방 채팅 입력"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!chatText.trim()}
            aria-label="채팅 전송"
          >
            <Send className="size-4" />
          </Button>
        </form>
      </div>

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
          onClick={() =>
            startLeaving(() => {
              router.push("/party");
              router.refresh();
            })
          }
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
