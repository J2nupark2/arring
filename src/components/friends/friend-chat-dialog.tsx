"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { useConversation } from "@/hooks/use-conversation";
import { ImageAttachmentPicker } from "@/components/chat/image-attachment-picker";
import { PrivateChatImage } from "@/components/chat/private-chat-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  removePrivateImage,
  uploadPrivateImage,
} from "@/lib/image-attachments";

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
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, open]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const value = text;
    if (!value.trim() && !imageFile) return;
    // Only clear the input once the send actually succeeds — clearing
    // eagerly makes a failed send look like it silently did nothing.
    setUploading(true);
    let imagePath: string | null = null;
    try {
      if (imageFile) {
        imagePath = await uploadPrivateImage(imageFile, {
          context: "direct-message",
          otherUserId: friendId,
        });
      }
      const ok = await send(value, imagePath);
      if (ok) {
        setText("");
        setImageFile(null);
      } else if (imagePath) {
        await removePrivateImage(imagePath);
      }
    } catch (error) {
      if (imagePath) await removePrivateImage(imagePath);
      toast.error(error instanceof Error ? error.message : "이미지를 보내지 못했습니다.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{friendNickname}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-32 flex-1 flex-col gap-2 overflow-y-auto rounded-md border p-3">
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
                <div
                  className={cn(
                    "max-w-[80%] space-y-1.5 rounded-lg px-3 py-1.5 text-sm break-words",
                    isMine
                      ? "bg-violet-600 text-white"
                      : "bg-muted text-foreground",
                  )}
                >
                  {m.image_path && (
                    <PrivateChatImage
                      path={m.image_path}
                      alt={`${friendNickname} 대화 첨부 이미지`}
                      className="max-h-56 border-white/20"
                    />
                  )}
                  {m.body && <p>{m.body}</p>}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        <div className="space-y-2">
          <ImageAttachmentPicker
            file={imageFile}
            onChange={setImageFile}
            disabled={sending || uploading}
          />
          <form onSubmit={handleSend} className="flex shrink-0 gap-2">
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
              disabled={sending || uploading || (!text.trim() && !imageFile)}
              aria-label="전송"
            >
              <Send className="size-4" />
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
