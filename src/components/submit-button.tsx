"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { VariantProps } from "class-variance-authority";

export function SubmitButton({
  children,
  pendingText,
  className,
  variant,
  size,
}: {
  children: React.ReactNode;
  pendingText: string;
  className?: string;
} & VariantProps<typeof buttonVariants>) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending}
      className={className}
      variant={variant}
      size={size}
    >
      {pending && <Loader2 className="animate-spin" />}
      {pending ? pendingText : children}
    </Button>
  );
}
