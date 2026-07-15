"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, MessageSquareText, Send } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageAttachmentPicker } from "@/components/chat/image-attachment-picker";
import { PrivateChatImage } from "@/components/chat/private-chat-image";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  removePrivateImage,
  uploadPrivateImage,
} from "@/lib/image-attachments";

export type SupportInquiry = {
  id: string;
  user_id: string;
  contact_email: string;
  category: string;
  subject: string;
  message: string;
  image_path: string | null;
  status: "open" | "answered" | "closed";
  admin_reply: string | null;
  answered_at: string | null;
  created_at: string;
  updated_at: string;
};

export const INQUIRY_CATEGORIES = [
  ["general", "일반 문의"],
  ["bug", "오류 제보"],
  ["account", "계정 문의"],
  ["privacy", "개인정보 요청"],
  ["partnership", "광고·제휴"],
] as const;

const categoryLabels = Object.fromEntries(INQUIRY_CATEGORIES);
const statusLabels = {
  open: "답변 대기",
  answered: "답변 완료",
  closed: "종료",
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function responseJson(response: Response) {
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    inquiries?: SupportInquiry[];
    inquiry?: SupportInquiry;
  };
  if (!response.ok) throw new Error(data.error ?? "요청을 처리하지 못했습니다.");
  return data;
}

export function SupportInquiries({ signedIn }: { signedIn: boolean }) {
  const [inquiries, setInquiries] = useState<SupportInquiry[]>([]);
  const [loading, setLoading] = useState(signedIn);
  const [saving, setSaving] = useState(false);
  const [category, setCategory] = useState("general");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);

  const load = useCallback(async () => {
    if (!signedIn) return;
    try {
      const data = await responseJson(
        await fetch("/api/inquiries", { cache: "no-store" }),
      );
      setInquiries(data.inquiries ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "문의 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;

    fetch("/api/inquiries", { cache: "no-store" })
      .then(responseJson)
      .then((data) => {
        if (!cancelled) setInquiries(data.inquiries ?? []);
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
  }, [signedIn]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    let imagePath: string | null = null;
    try {
      if (imageFile) {
        imagePath = await uploadPrivateImage(imageFile, { context: "inquiry" });
      }
      const data = await responseJson(
        await fetch("/api/inquiries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category, subject, message, imagePath }),
        }),
      );
      if (data.inquiry) setInquiries((current) => [data.inquiry!, ...current]);
      setSubject("");
      setMessage("");
      setImageFile(null);
      toast.success("문의가 접수되었습니다.");
    } catch (error) {
      if (imagePath) await removePrivateImage(imagePath);
      toast.error(error instanceof Error ? error.message : "문의를 접수하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-10">
      <section className="space-y-4" aria-labelledby="inquiry-form-title">
        <div>
          <h2 id="inquiry-form-title" className="text-lg font-semibold">문의 접수</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            접수한 문의와 관리자 답변은 이 페이지에서 확인할 수 있습니다.
          </p>
        </div>

        {!signedIn ? (
          <div className="flex flex-col items-start gap-3 border-y py-6">
            <p className="text-sm text-muted-foreground">문의 작성과 답변 확인에는 로그인이 필요합니다.</p>
            <Button asChild>
              <Link href="/login?next=%2Fcontact">로그인하고 문의하기</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4 border-y py-6">
            <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
              <div className="grid gap-1.5">
                <Label htmlFor="inquiry-category">문의 유형</Label>
                <select
                  id="inquiry-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {INQUIRY_CATEGORIES.map(([value, label]) => (
                    <option key={value} value={value} className="bg-popover text-popover-foreground">
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="inquiry-subject">제목</Label>
                <Input
                  id="inquiry-subject"
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  minLength={2}
                  maxLength={120}
                  placeholder="문의 내용을 짧게 적어주세요"
                  required
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="inquiry-message">내용</Label>
                <span className="text-xs tabular-nums text-muted-foreground">{message.length}/5,000</span>
              </div>
              <textarea
                id="inquiry-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                minLength={10}
                maxLength={5000}
                rows={7}
                placeholder="문제가 발생한 페이지, 시간, 재현 순서를 함께 적으면 더 빠르게 확인할 수 있습니다."
                className="resize-y rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                required
              />
            </div>
            <ImageAttachmentPicker
              file={imageFile}
              onChange={setImageFile}
              disabled={saving}
            />
            <Button type="submit" disabled={saving} className="justify-self-start">
              {saving ? <Loader2 className="animate-spin" /> : <Send />}
              {saving ? "접수 중" : "문의 접수"}
            </Button>
          </form>
        )}
      </section>

      {signedIn && (
        <section className="space-y-4" aria-labelledby="my-inquiries-title">
          <div className="flex items-center justify-between gap-3">
            <h2 id="my-inquiries-title" className="text-lg font-semibold">내 문의</h2>
            <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
              {loading && <Loader2 className="animate-spin" />}
              새로고침
            </Button>
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">문의 내역을 불러오는 중입니다.</p>
          ) : inquiries.length === 0 ? (
            <div className="flex flex-col items-center gap-2 border-y py-10 text-center">
              <MessageSquareText className="size-5 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">접수한 문의가 없습니다.</p>
            </div>
          ) : (
            <div className="divide-y border-y">
              {inquiries.map((inquiry) => (
                <article key={inquiry.id} className="space-y-4 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{categoryLabels[inquiry.category] ?? inquiry.category}</Badge>
                        <Badge
                          variant={inquiry.status === "open" ? "secondary" : inquiry.status === "answered" ? "default" : "outline"}
                        >
                          {statusLabels[inquiry.status]}
                        </Badge>
                      </div>
                      <h3 className="mt-2 break-words font-medium">{inquiry.subject}</h3>
                    </div>
                    <time className="shrink-0 text-xs text-muted-foreground" dateTime={inquiry.created_at}>
                      {formatDate(inquiry.created_at)}
                    </time>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                    {inquiry.message}
                  </p>
                  {inquiry.image_path && (
                    <PrivateChatImage
                      path={inquiry.image_path}
                      alt={`${inquiry.subject} 첨부 이미지`}
                    />
                  )}
                  {inquiry.admin_reply && (
                    <div className="border-l-2 border-primary pl-4">
                      <p className="text-xs font-semibold text-primary">관리자 답변</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">
                        {inquiry.admin_reply}
                      </p>
                      {inquiry.answered_at && (
                        <time className="mt-2 block text-xs text-muted-foreground" dateTime={inquiry.answered_at}>
                          {formatDate(inquiry.answered_at)}
                        </time>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
