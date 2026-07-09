"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useVoiceRoom } from "@/hooks/use-voice-room";
import { sendFriendRequest } from "@/hooks/use-friends";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Check,
  Crown,
  Eye,
  Headphones,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  UserPlus,
  UserCheck,
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = participants.find((p) => p.id === selectedId) ?? null;

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
        <p className="text-sm text-muted-foreground">연결하는 중...</p>
      )}
      {status === "error" && (
        <p className="text-sm text-destructive">
          방장은 마이크 권한이 필요합니다. 브라우저 설정에서 마이크 권한을
          허용해주세요.
        </p>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>참가자</span>
        <span>
          {participants.length}/{maxMembers}명
        </span>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
        {participants.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelectedId(p.id)}
            className="flex flex-col items-center gap-1 rounded-md border px-1.5 py-2 text-center transition-colors hover:bg-muted/50"
          >
            <span className="relative">
              <Avatar
                className={cn(
                  "size-10 transition-shadow",
                  speaking[p.id] &&
                    "ring-2 ring-green-500 ring-offset-2 ring-offset-card",
                )}
              >
                <AvatarFallback>{p.nickname.slice(0, 1)}</AvatarFallback>
              </Avatar>
              {p.id === hostId && (
                <Crown
                  className="absolute -top-1 -right-1 size-3.5 fill-amber-500 text-amber-500"
                  aria-label="방장"
                />
              )}
              <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full bg-card ring-1 ring-border">
                {p.id !== hostId ? (
                  <Headphones className="size-2.5 text-muted-foreground" />
                ) : p.muted ? (
                  <MicOff className="size-2.5 text-muted-foreground" />
                ) : (
                  <Mic className="size-2.5 text-muted-foreground" />
                )}
              </span>
            </span>
            <span className="w-full truncate text-xs font-medium">
              {p.nickname}
              {p.isSelf && " (나)"}
            </span>
          </button>
        ))}
      </div>

      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <DialogContent className="sm:max-w-xs">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Avatar className="size-8">
                    <AvatarFallback>
                      {selected.nickname.slice(0, 1)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex items-center gap-1">
                    {selected.id === hostId && (
                      <Crown className="size-4 text-amber-500" aria-label="방장" />
                    )}
                    {selected.nickname}
                    {selected.isSelf && " (나)"}
                  </span>
                </DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                {/* Only the host publishes audio, so a volume slider only
                    makes sense on the host's tile. */}
                {!selected.isSelf && selected.id === hostId && (
                  <div className="flex items-center gap-2">
                    <Volume2 className="size-4 shrink-0 text-muted-foreground" />
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round((volumes[selected.id] ?? 1) * 100)}
                      onChange={(e) =>
                        setParticipantVolume(
                          selected.id,
                          Number(e.target.value) / 100,
                        )
                      }
                      className="h-1.5 w-full cursor-pointer accent-primary"
                      aria-label={`${selected.nickname} 소리 크기`}
                    />
                    <span className="w-9 shrink-0 text-right text-xs text-muted-foreground">
                      {Math.round((volumes[selected.id] ?? 1) * 100)}%
                    </span>
                  </div>
                )}
                {selected.characterRowId && (
                  <Button variant="outline" asChild>
                    <Link href={`/profile/characters/${selected.characterRowId}`}>
                      <Eye className="size-4" />
                      상세 프로필
                    </Link>
                  </Button>
                )}
                {!selected.isSelf && !isGuest && (
                  selected.isFriend ? (
                    <Button variant="secondary" disabled>
                      <UserCheck className="size-4" />
                      친구
                      <Check className="size-3.5" />
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => sendFriendRequest(selected.id)}
                    >
                      <UserPlus className="size-4" />
                      친구 추가
                    </Button>
                  )
                )}
                {isHost && !selected.isSelf && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => {
                        transferHost(selected.id);
                        setSelectedId(null);
                      }}
                    >
                      <Crown className="size-4" />
                      방장 위임
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        kickParticipant(selected.id);
                        setSelectedId(null);
                      }}
                    >
                      <UserX className="size-4" />
                      추방
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

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

      {/* Only the host publishes audio — listeners have no mic controls. */}
      {isHost && (
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
      )}

      <div className="flex justify-center gap-3">
        {isHost && (
          <Button
            variant={muted ? "default" : "outline"}
            size="icon-lg"
            onClick={toggleMute}
            aria-label={muted ? "음소거 해제" : "음소거"}
          >
            {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </Button>
        )}
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
