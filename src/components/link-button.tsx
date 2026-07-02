"use client";

import Link, { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";

// Must live inside the <Link> so useLinkStatus can find its context.
function PendingSpinner() {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 className="size-4 animate-spin" /> : null;
}

// Navigation button that shows a spinner while the destination page loads,
// so slow server-rendered pages don't feel like dead clicks.
export function LinkButton({
  href,
  children,
  className,
  variant,
  size,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
} & VariantProps<typeof buttonVariants>) {
  return (
    <Button className={className} variant={variant} size={size} asChild>
      <Link href={href}>
        <PendingSpinner />
        {children}
      </Link>
    </Button>
  );
}
