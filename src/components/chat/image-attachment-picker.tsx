"use client";

import Image from "next/image";
import { useEffect, useId, useMemo } from "react";
import { ImagePlus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  IMAGE_ACCEPT,
  MAX_IMAGE_BYTES,
} from "@/lib/image-attachments";

export function ImageAttachmentPicker({
  file,
  onChange,
  disabled = false,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}) {
  const inputId = useId();
  const preview = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  return (
    <div className="space-y-2">
      {preview && file && (
        <div className="relative w-fit overflow-hidden rounded-md border bg-muted">
          <Image
            src={preview}
            alt="첨부 이미지 미리보기"
            width={240}
            height={160}
            unoptimized
            className="max-h-40 w-auto max-w-full object-contain"
          />
          <Button
            type="button"
            variant="secondary"
            size="icon-sm"
            className="absolute right-1 top-1"
            onClick={() => onChange(null)}
            disabled={disabled}
            aria-label="첨부 이미지 제거"
          >
            <X />
          </Button>
        </div>
      )}
      <input
        id={inputId}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.files?.[0] ?? null;
          event.target.value = "";
          if (!next) return;
          if (next.size > MAX_IMAGE_BYTES) {
            toast.error("이미지는 5MB 이하만 첨부할 수 있습니다.");
            return;
          }
          if (!IMAGE_ACCEPT.split(",").includes(next.type)) {
            toast.error("JPEG, PNG, WebP 이미지만 첨부할 수 있습니다.");
            return;
          }
          onChange(next);
        }}
      />
      {!file && (
        <Button type="button" variant="outline" size="sm" asChild>
          <label htmlFor={inputId} aria-disabled={disabled} className="cursor-pointer">
            <ImagePlus /> 이미지 첨부
          </label>
        </Button>
      )}
    </div>
  );
}
