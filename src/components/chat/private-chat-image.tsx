"use client";

import Image from "next/image";

import { privateImageUrl } from "@/lib/image-attachments";
import { cn } from "@/lib/utils";

export function PrivateChatImage({
  path,
  alt = "첨부 이미지",
  className,
}: {
  path: string;
  alt?: string;
  className?: string;
}) {
  return (
    <a
      href={privateImageUrl(path)}
      target="_blank"
      rel="noreferrer"
      className="block w-fit max-w-full"
    >
      <Image
        src={privateImageUrl(path)}
        alt={alt}
        width={640}
        height={480}
        unoptimized
        className={cn(
          "max-h-72 w-auto max-w-full rounded-md border object-contain",
          className,
        )}
      />
    </a>
  );
}
