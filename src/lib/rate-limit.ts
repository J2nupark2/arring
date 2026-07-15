import "server-only";

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
};

type RateLimitOptions = {
  scope: string;
  limit: number;
  windowSeconds: number;
  identifier?: string;
  failureMode?: "open" | "closed";
};

function requestIdentifier(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export async function enforceRateLimit(
  request: NextRequest,
  options: RateLimitOptions,
) {
  const rawKey = `${options.scope}:${options.identifier ?? requestIdentifier(request)}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");

  try {
    const { data, error } = await createAdminClient().rpc("consume_api_rate_limit", {
      p_key_hash: keyHash,
      p_limit: options.limit,
      p_window_seconds: options.windowSeconds,
    });

    if (error) throw error;
    const result = data as unknown as RateLimitResult;
    if (result.allowed) return null;

    return NextResponse.json(
      {
        error: `요청이 너무 많습니다. ${result.retryAfter}초 후 다시 시도해주세요.`,
        retryAfterSeconds: result.retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(result.retryAfter),
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: "rate_limit_check_failed",
      scope: options.scope,
      message: error instanceof Error ? error.message : String(error),
    }));
    if (options.failureMode === "open") return null;

    return NextResponse.json(
      { error: "요청 보호 기능을 확인할 수 없습니다. 잠시 후 다시 시도해주세요." },
      {
        status: 503,
        headers: { "Retry-After": "5" },
      },
    );
  }
}
