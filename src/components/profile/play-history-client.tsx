"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Eye, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export type PlayHistoryItem = {
  roomId: string;
  roomCode: string;
  title: string;
  status: string;
  joinedAt: string;
  leftAt: string | null;
  dungeonName: string | null;
  gimmickStage: number | null;
  participants: {
    userId: string;
    nickname: string;
    server: string | null;
    characterRowId: string | null;
    alreadyEvaluated: boolean;
  }[];
};

type ReviewTarget = {
  roomId: string;
  userId: string;
  nickname: string;
};

export function PlayHistoryClient({
  items,
}: {
  items: PlayHistoryItem[];
}) {
  const [historyItems, setHistoryItems] = useState(items);
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [gimmickReview, setGimmickReview] =
    useState<"mastered" | "uncertain" | "not_mastered">("uncertain");
  const [mannerReview, setMannerReview] =
    useState<"good" | "normal" | "bad">("normal");
  const [reportReason, setReportReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const totalPartyCount = useMemo(() => historyItems.length, [historyItems]);

  async function submitReview() {
    if (!reviewTarget) return;

    setSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("submit_party_evaluation", {
      target_room_id: reviewTarget.roomId,
      target_user_id: reviewTarget.userId,
      p_gimmick_review: gimmickReview,
      p_manner_review: mannerReview,
      p_report_reason: reportReason || null,
    });
    setSubmitting(false);

    if (error) {
      toast.error(`평가 저장 실패: ${error.message}`);
      return;
    }

    setHistoryItems((current) =>
      current.map((item) =>
        item.roomId !== reviewTarget.roomId
          ? item
          : {
              ...item,
              participants: item.participants.map((participant) =>
                participant.userId === reviewTarget.userId
                  ? { ...participant, alreadyEvaluated: true }
                  : participant,
              ),
            },
      ),
    );
    toast.success("평가가 반영됐습니다.");
    setReviewTarget(null);
    setGimmickReview("uncertain");
    setMannerReview("normal");
    setReportReason("");
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">플레이 기록</h1>
          <p className="text-sm text-muted-foreground">
            내가 참가한 파티 기록만 표시됩니다. 파티원이 먼저 나갔어도 여기서 평가할 수 있어요.
          </p>
        </div>
        <Badge variant="outline">{totalPartyCount}회</Badge>
      </div>

      {historyItems.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            아직 플레이 기록이 없습니다.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {historyItems.map((item) => (
            <Card key={item.roomId}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    <CardDescription>
                      {item.dungeonName ?? "수동 통화방"}
                      {item.gimmickStage !== null && ` · ${item.gimmickStage}단계`}
                      {" · "}
                      {formatDate(item.joinedAt)}
                    </CardDescription>
                  </div>
                  <Badge variant={item.status === "active" ? "secondary" : "outline"}>
                    {item.status === "active" ? "진행중" : "종료"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {item.participants.map((participant) => (
                  <div
                    key={participant.userId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar className="size-7">
                        <AvatarFallback>
                          {participant.nickname.slice(0, 1)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {participant.nickname}
                          {participant.server && ` (${participant.server})`}
                        </div>
                        {participant.alreadyEvaluated && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Check className="size-3" />
                            평가 완료
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {participant.characterRowId && (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/profile/characters/${participant.characterRowId}`}>
                            <Eye className="size-3.5" />
                            상세
                          </Link>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={participant.alreadyEvaluated}
                        onClick={() =>
                          setReviewTarget({
                            roomId: item.roomId,
                            userId: participant.userId,
                            nickname: participant.nickname,
                          })
                        }
                      >
                        {participant.alreadyEvaluated ? "완료" : "평가"}
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!reviewTarget}
        onOpenChange={(open) => {
          if (!open) setReviewTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {reviewTarget && (
            <>
              <DialogHeader>
                <DialogTitle>{reviewTarget.nickname} 평가</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-4">
                <ChoiceGroup
                  label="기믹 단계 숙련도"
                  value={gimmickReview}
                  options={[
                    ["mastered", "숙련"],
                    ["uncertain", "애매"],
                    ["not_mastered", "미숙지"],
                  ]}
                  onChange={(value) =>
                    setGimmickReview(value as "mastered" | "uncertain" | "not_mastered")
                  }
                />
                <ChoiceGroup
                  label="다시 함께 플레이하고 싶은가요?"
                  value={mannerReview}
                  options={[
                    ["good", "좋음"],
                    ["normal", "보통"],
                    ["bad", "싫음"],
                  ]}
                  onChange={(value) => setMannerReview(value as "good" | "normal" | "bad")}
                />
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
                <Button onClick={submitReview} disabled={submitting}>
                  {submitting && <Loader2 className="size-4 animate-spin" />}
                  평가 제출
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChoiceGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <div className="grid grid-cols-3 gap-2">
        {options.map(([optionValue, optionLabel]) => (
          <Button
            key={optionValue}
            type="button"
            variant={value === optionValue ? "default" : "outline"}
            onClick={() => onChange(optionValue)}
          >
            {optionLabel}
          </Button>
        ))}
      </div>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
