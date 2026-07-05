"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { useConversation } from "@/hooks/use-conversation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function FriendChatDialog({
  friendId,
  friendNickname,
  open,
  onOpenChange,
  onRead,
}: {
  friendId: string;
  friendNickname: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRead?: () => void;
}) {
  const { messages, loading, sending, send, myId } = useConversation(
    friendId,
    onRead,
  );
  const [text, setText] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, open]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const value = text;
    if (!value.trim()) return;
    setText("");
    await send(value);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{friendNickname}</DialogTitle>
        </DialogHeader>
        <div className="flex h-80 flex-col gap-2 overflow-y-auto rounded-md border p-3">
          {loading && (
            <p className="text-sm text-muted-foreground">불러오는 중...</p>
          )}
          {!loading && messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              아직 메시지가 없어요. 먼저 인사해보세요!
            </p>
          )}
          {messages.map((m) => {
            const isMine = m.sender_id === myId;
            return (
              <div
                key={m.id}
                className={cn("flex", isMine ? "justify-end" : "justify-start")}
              >
                <span
                  className={cn(
                    "max-w-[80%] rounded-lg px-3 py-1.5 text-sm break-words",
                    isMine
                      ? "bg-violet-600 text-white"
                      : "bg-muted text-foreground",
                  )}
                >
                  {m.body}
                </span>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={handleSend} className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="메시지 입력..."
            maxLength={2000}
            aria-label="메시지 입력"
          />
          <Button
            type="submit"
            size="icon"
            disabled={sending || !text.trim()}
            aria-label="전송"
          >
            <Send className="size-4" />
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
