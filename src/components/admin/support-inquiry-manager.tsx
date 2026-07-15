"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, MessageSquareText, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import {
  INQUIRY_CATEGORIES,
  type SupportInquiry,
} from "@/components/contact/support-inquiries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const categoryLabels = Object.fromEntries(INQUIRY_CATEGORIES);
const statusLabels = { open: "대기", answered: "답변", closed: "종료" };
const filters = [
  ["all", "전체"],
  ["open", "답변 대기"],
  ["answered", "답변 완료"],
  ["closed", "종료"],
] as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

async function readResponse(response: Response) {
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    inquiries?: SupportInquiry[];
    inquiry?: SupportInquiry;
  };
  if (!response.ok) throw new Error(data.error ?? "요청을 처리하지 못했습니다.");
  return data;
}

export function SupportInquiryManager() {
  const [inquiries, setInquiries] = useState<SupportInquiry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof filters)[number][0]>("open");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await readResponse(await fetch("/api/inquiries", { cache: "no-store" }));
      const next = data.inquiries ?? [];
      setInquiries(next);
      setSelectedId((current) =>
        current && next.some((item) => item.id === current)
          ? current
          : next[0]?.id ?? null,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "문의 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/inquiries", { cache: "no-store" })
      .then(readResponse)
      .then((data) => {
        if (cancelled) return;
        const next = data.inquiries ?? [];
        setInquiries(next);
        setSelectedId(next[0]?.id ?? null);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : "문의 목록을 불러오지 못했습니다.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () => inquiries.filter((item) => filter === "all" || item.status === filter),
    [filter, inquiries],
  );
  const selected = inquiries.find((item) => item.id === selectedId) ?? null;
  const reply = selected
    ? (replyDrafts[selected.id] ?? selected.admin_reply ?? "")
    : "";

  async function updateInquiry(status: SupportInquiry["status"]) {
    if (!selected) return;
    setSaving(true);
    try {
      const data = await readResponse(
        await fetch("/api/inquiries", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: selected.id, reply, status }),
        }),
      );
      if (data.inquiry) {
        setInquiries((current) =>
          current.map((item) =>
            item.id === data.inquiry!.id ? data.inquiry! : item,
          ),
        );
      }
      toast.success(
        status === "answered"
          ? "답변을 등록했습니다."
          : status === "closed"
            ? "문의를 종료했습니다."
            : "문의를 다시 열었습니다.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "문의 상태를 변경하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="support-manager-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="support-manager-title" className="text-lg font-semibold">문의 관리</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            접수된 문의를 확인하고 답변 상태를 관리합니다.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn(loading && "animate-spin")} />
          새로고침
        </Button>
      </div>

      <div className="flex flex-wrap gap-1 border-b pb-3" role="tablist" aria-label="문의 상태 필터">
        {filters.map(([value, label]) => {
          const count =
            value === "all"
              ? inquiries.length
              : inquiries.filter((item) => item.status === value).length;
          return (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={filter === value ? "secondary" : "ghost"}
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
            >
              {label} <span className="tabular-nums text-muted-foreground">{count}</span>
            </Button>
          );
        })}
      </div>

      <div className="grid min-h-[430px] overflow-hidden rounded-lg border md:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.4fr)]">
        <div className="max-h-[620px] overflow-y-auto border-b md:border-r md:border-b-0">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <MessageSquareText className="size-5" />
              해당 문의가 없습니다.
            </div>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={cn(
                  "block w-full border-b px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-muted/50",
                  selectedId === item.id && "bg-muted",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={item.status === "open" ? "secondary" : "outline"}>
                    {statusLabels[item.status]}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{formatDate(item.created_at)}</span>
                </div>
                <p className="mt-2 truncate text-sm font-medium">{item.subject}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{item.contact_email}</p>
              </button>
            ))
          )}
        </div>

        <div className="min-w-0 p-4 sm:p-5">
          {!selected ? (
            <div className="flex h-full min-h-48 items-center justify-center text-sm text-muted-foreground">
              확인할 문의를 선택해 주세요.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-2 border-b pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {categoryLabels[selected.category] ?? selected.category}
                  </Badge>
                  <Badge variant={selected.status === "open" ? "secondary" : "outline"}>
                    {statusLabels[selected.status]}
                  </Badge>
                </div>
                <h3 className="break-words text-base font-semibold">{selected.subject}</h3>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{selected.contact_email}</span>
                  <time dateTime={selected.created_at}>{formatDate(selected.created_at)}</time>
                </div>
              </div>
              <p className="min-h-20 whitespace-pre-wrap break-words text-sm leading-6">
                {selected.message}
              </p>
              <div className="grid gap-1.5 border-t pt-4">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="support-reply">관리자 답변</Label>
                  <span className="text-xs tabular-nums text-muted-foreground">{reply.length}/5,000</span>
                </div>
                <textarea
                  id="support-reply"
                  value={reply}
                  onChange={(event) => {
                    if (!selected) return;
                    setReplyDrafts((current) => ({
                      ...current,
                      [selected.id]: event.target.value,
                    }));
                  }}
                  rows={7}
                  maxLength={5000}
                  placeholder="사용자에게 전달할 답변을 입력하세요."
                  className="resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void updateInquiry("answered")}
                  disabled={saving || reply.trim().length < 2}
                >
                  {saving ? <Loader2 className="animate-spin" /> : <Check />}
                  답변 등록
                </Button>
                {selected.status === "closed" ? (
                  <Button variant="outline" onClick={() => void updateInquiry("open")} disabled={saving}>
                    다시 열기
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => void updateInquiry("closed")} disabled={saving}>
                    문의 종료
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
