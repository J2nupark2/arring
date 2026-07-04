"use client";

import { toast } from "sonner";
import { Check, Copy, Link2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyInvite({ code }: { code: string }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  async function copy(kind: "code" | "link") {
    const text =
      kind === "code" ? code : `${window.location.origin}/room/${code}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      toast.success(
        kind === "code" ? "방 코드가 복사되었습니다" : "초대 링크가 복사되었습니다",
      );
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error("복사에 실패했습니다. 직접 선택해서 복사해주세요.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => copy("code")}>
        {copied === "code" ? (
          <Check className="size-4 text-green-500" />
        ) : (
          <Copy className="size-4" />
        )}
        코드 복사
      </Button>
      <Button variant="outline" size="sm" onClick={() => copy("link")}>
        {copied === "link" ? (
          <Check className="size-4 text-green-500" />
        ) : (
          <Link2 className="size-4" />
        )}
        초대 링크 복사
      </Button>
    </div>
  );
}
