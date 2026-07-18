"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type MatchStatus = {
  matched: boolean;
  roomCode?: string;
  active?: boolean;
  state?: "idle" | "waiting" | "processing" | "matched" | "cancelled";
  role?: "leader" | "member";
  waitingCount?: number;
  needed?: number;
  since?: string;
  status?: string;
  inviteStatuses?: {
    userId: string;
    status: "pending" | "accepted" | "declined" | "cancelled";
  }[];
  temporaryMatch?: {
    id: string;
    expiresAt: string;
    responseStatus: "pending" | "accepted" | "rejected" | "expired";
    responses: { userId: string; status: "pending" | "accepted" | "rejected" | "expired" }[];
    score: number;
    role: "leader" | "member";
  } | null;
  canAutoLead?: boolean;
  autoLeadEligibleAt?: string | null;
  autoLeadAfterSeconds?: number | null;
};

export function MatchFloatingStatus({
  status,
  cancelling,
  responding,
  nowMs,
  onCancel,
  onRespond,
}: {
  status: MatchStatus;
  cancelling: boolean;
  responding: boolean;
  nowMs: number;
  onCancel: () => void;
  onRespond: (action: "accept" | "reject") => void;
}) {
  const isLeader = status.role === "leader";
  const waitingCount = status.waitingCount ?? 0;
  const needed = status.needed ?? 0;
  const temporaryMatch = status.temporaryMatch;
  const remainingSeconds = temporaryMatch
    ? Math.max(
        0,
        Math.ceil((new Date(temporaryMatch.expiresAt).getTime() - nowMs) / 1000),
      )
    : 0;
  const autoLeadRemainingSeconds = status.autoLeadEligibleAt
    ? Math.max(
        0,
        Math.ceil((new Date(status.autoLeadEligibleAt).getTime() - nowMs) / 1000),
      )
    : 0;

  if (temporaryMatch) {
    return (
      <div className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-md rounded-lg border bg-card/95 p-4 text-card-foreground shadow-xl backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Loader2 className="size-4 animate-spin text-primary" />
              매칭 수락 대기 중
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              전원 응답이 확인되면 파티가 확정됩니다. {remainingSeconds}초 남음
            </p>
            {temporaryMatch.role === "leader" && (
              <p className="mt-1 text-xs font-medium text-primary">
                파티장으로 매칭됩니다.
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={responding || temporaryMatch.responseStatus === "accepted"}
              onClick={() => onRespond("reject")}
            >
              거절
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={responding || temporaryMatch.responseStatus === "accepted"}
              onClick={() => onRespond("accept")}
            >
              {responding && <Loader2 className="size-3.5 animate-spin" />}
              {temporaryMatch.responseStatus === "accepted" ? "수락 완료" : "수락"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-md rounded-lg border bg-card/95 p-4 text-card-foreground shadow-xl backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Loader2 className="size-4 animate-spin text-primary" />
            매칭 대기 중
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {isLeader
              ? `조건에 맞는 파티원을 찾는 중입니다. ${waitingCount}/${needed}명`
              : "조건에 맞는 파티가 열리면 자동으로 방에 입장합니다."}
          </p>
          {!isLeader && status.canAutoLead && (
            <p className="mt-1 text-xs font-medium text-primary">
              {autoLeadRemainingSeconds > 0
                ? `파티장 전환 가능까지 ${autoLeadRemainingSeconds}초`
                : "파티장 후보로 전환됨. 설정한 조건으로 파티원을 찾는 중입니다."}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={cancelling}
          onClick={onCancel}
        >
          {cancelling && <Loader2 className="size-3.5 animate-spin" />}
          취소
        </Button>
      </div>
    </div>
  );
}
