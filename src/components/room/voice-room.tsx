"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useVoiceRoom } from "@/hooks/use-voice-room";
import { sendFriendRequest } from "@/hooks/use-friends";
import { createClient } from "@/lib/supabase/client";
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
  Copy,
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
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function VoiceRoom({
  roomCode,
  roomId,
  userId,
  nickname,
  inviteName,
  maxMembers,
  initialHostId,
  isGuest = false,
}: {
  roomCode: string;
  roomId: string;
  userId: string;
  nickname: string;
  inviteName: string;
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
    audioInputs,
    selectedMicId,
    switchingMic,
    switchMicDevice,
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
    inviteName,
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
  const [reviewTargetId, setReviewTargetId] = useState<string | null>(null);
  const [gimmickReview, setGimmickReview] =
    useState<"mastered" | "uncertain" | "not_mastered">("uncertain");
  const [mannerReview, setMannerReview] =
    useState<"good" | "normal" | "bad">("normal");
  const [reportReason, setReportReason] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const selected = participants.find((p) => p.id === selectedId) ?? null;
  const reviewTarget = participants.find((p) => p.id === reviewTargetId) ?? null;

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ block: "end" });
  }, [chatMessages.length]);

  function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!chatText.trim()) return;
    sendChatMessage(chatText);
    setChatText("");
  }

  async function copyInviteName(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${value} 복사 완료`);
    } catch {
      toast.error("닉네임 복사에 실패했습니다.");
    }
  }

  async function submitReview() {
    if (!reviewTarget) return;
    setSubmittingReview(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("submit_party_evaluation", {
      target_room_id: roomId,
      target_user_id: reviewTarget.id,
      p_gimmick_review: gimmickReview,
      p_manner_review: mannerReview,
      p_report_reason: reportReason || null,
    });
    setSubmittingReview(false);

    if (error) {
      toast.error(`평가 저장 실패: ${error.message}`);
      return;
    }

    toast.success("평가가 반영됐습니다.");
    setReviewTargetId(null);
    setReportReason("");
    setGimmickReview("uncertain");
    setMannerReview("normal");
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
                <Button
                  variant="outline"
                  onClick={() => copyInviteName(selected.inviteName)}
                >
                  <Copy className="size-4" />
                  인게임 닉네임 복사
                </Button>
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
                {!selected.isSelf && !isGuest && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setReviewTargetId(selected.id);
                      setSelectedId(null);
                    }}
                  >
                    평가하기
                  </Button>
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

      <Dialog
        open={!!reviewTarget}
        onOpenChange={(open) => {
          if (!open) setReviewTargetId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {reviewTarget && (
            <>
              <DialogHeader>
                <DialogTitle>{reviewTarget.nickname} 평가</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium">기믹 단계 숙련도</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      ["mastered", "숙련"],
                      ["uncertain", "애매"],
                      ["not_mastered", "미숙지"],
                    ].map(([value, label]) => (
                      <Button
                        key={value}
                        type="button"
                        variant={gimmickReview === value ? "default" : "outline"}
                        onClick={() =>
                          setGimmickReview(
                            value as "mastered" | "uncertain" | "not_mastered",
                          )
                        }
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">다시 함께 플레이하고 싶은가요?</div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      ["good", "좋음"],
                      ["normal", "보통"],
                      ["bad", "싫음"],
                    ].map(([value, label]) => (
                      <Button
                        key={value}
                        type="button"
                        variant={mannerReview === value ? "default" : "outline"}
                        onClick={() =>
                          setMannerReview(value as "good" | "normal" | "bad")
                        }
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">신고 사유</div>
                  <select
                    value={reportReason}
                    onChange={(event) => setReportReason(event.target.value)}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    aria-label="신고 사유"
                  >
                    <option value="">없음</option>
                    <option value="abusive_chat">욕설/비매너 채팅</option>
                    <option value="intentional_disruption">고의 방해</option>
                    <option value="early_leave">중도 이탈</option>
                    <option value="false_progress">허위 숙련도</option>
                    <option value="other">기타</option>
                  </select>
                </div>

                <Button onClick={submitReview} disabled={submittingReview}>
                  {submittingReview && <Loader2 className="size-4 animate-spin" />}
                  평가 제출
                </Button>
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
        <div className="flex flex-col gap-3 rounded-md border px-3 py-3">
          <div className="flex items-center gap-2">
            <Mic className="size-4 shrink-0 text-muted-foreground" />
            <label htmlFor="microphone-device" className="shrink-0 text-sm">
              마이크 기기
            </label>
            <select
              id="microphone-device"
              value={selectedMicId}
              disabled={switchingMic || audioInputs.length === 0}
              onChange={async (event) => {
                const changed = await switchMicDevice(event.target.value);
                if (!changed) toast.error("마이크 기기를 변경하지 못했습니다.");
              }}
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
            >
              {audioInputs.length === 0 && <option value="">기본 마이크</option>}
              {audioInputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
            {switchingMic && <Loader2 className="size-4 shrink-0 animate-spin" />}
          </div>
          <div className="flex items-center gap-2">
            <Volume2 className="size-4 shrink-0 text-muted-foreground" />
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
