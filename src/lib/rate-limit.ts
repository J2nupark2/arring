import "server-only";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
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

async function consumeRateLimit(options: RateLimitOptions, identifier: string) {
  const rawKey = `${options.scope}:${identifier}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const { data, error } = await createAdminClient().rpc("consume_api_rate_limit", {
    p_key_hash: keyHash,
    p_limit: options.limit,
    p_window_seconds: options.windowSeconds,
  });

  if (error) throw error;
  return data as unknown as RateLimitResult;
}

export async function enforceActionRateLimit(
  options: Omit<RateLimitOptions, "failureMode">,
) {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || requestHeaders.get("x-real-ip") || "unknown";

  try {
    const identifier = options.identifier ? `${ip}:${options.identifier}` : ip;
    const result = await consumeRateLimit(options, identifier);
    if (result.allowed) return null;
    return `요청이 너무 많습니다. ${result.retryAfter}초 후 다시 시도해주세요.`;
  } catch (error) {
    console.error(JSON.stringify({
      event: "rate_limit_check_failed",
      scope: options.scope,
      message: error instanceof Error ? error.message : String(error),
    }));
    return "요청 보호 기능을 확인할 수 없습니다. 잠시 후 다시 시도해주세요.";
  }
}

export async function enforceRateLimit(
  request: NextRequest,
  options: RateLimitOptions,
) {
  try {
    const result = await consumeRateLimit(
      options,
      options.identifier ?? requestIdentifier(request),
    );
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
