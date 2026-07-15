import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    const { error } = await createAdminClient()
      .from("dungeons")
      .select("id", { count: "exact", head: true });

    if (error) throw error;

    return NextResponse.json(
      {
        status: "ok",
        database: "ok",
        latencyMs: Date.now() - startedAt,
        version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
        timestamp: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: "health_check_failed",
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    return NextResponse.json(
      {
        status: "degraded",
        database: "unavailable",
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "10" },
      },
    );
  }
}
