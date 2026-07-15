import { createHash, timingSafeEqual } from "node:crypto";
import { gzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BACKUP_BUCKET = "production-backups";
const RETENTION_DAYS = 30;
const TABLES = [
  "aion2_characters",
  "class_stat_priority",
  "direct_messages",
  "dungeon_progress",
  "dungeons",
  "friend_requests",
  "kick_votes",
  "match_queue",
  "match_requests",
  "match_responses",
  "matching_invites",
  "party_evaluations",
  "party_reviews",
  "player_score_events",
  "profiles",
  "room_invites",
  "room_participants",
  "rooms",
  "score_history",
  "temporary_matches",
  "user_gimmick_trust_scores",
] as const;

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";

  const authorization = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const actualBuffer = Buffer.from(authorization);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

async function ensurePrivateBucket() {
  const admin = createAdminClient();
  const { data } = await admin.storage.getBucket(BACKUP_BUCKET);
  if (data) return;

  const { error } = await admin.storage.createBucket(BACKUP_BUCKET, {
    public: false,
    fileSizeLimit: "50MB",
  });
  if (error && !error.message.toLowerCase().includes("already exists")) {
    throw new Error(`Backup bucket: ${error.message}`);
  }
}

async function removeExpiredBackups() {
  const admin = createAdminClient();
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const { data, error } = await admin.storage.from(BACKUP_BUCKET).list("", {
    limit: 1000,
    sortBy: { column: "created_at", order: "asc" },
  });
  if (error) throw new Error(`List backups: ${error.message}`);

  const expired = (data ?? [])
    .filter((file) => file.created_at && Date.parse(file.created_at) < cutoff)
    .map((file) => file.name);
  if (expired.length === 0) return 0;

  const { error: removeError } = await admin.storage
    .from(BACKUP_BUCKET)
    .remove(expired);
  if (removeError) throw new Error(`Remove old backups: ${removeError.message}`);
  return expired.length;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const tables: Record<string, unknown[]> = {};
    let totalRows = 0;

    for (const table of TABLES) {
      const rows: unknown[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await admin
          .from(table)
          .select("*")
          .range(offset, offset + 999);
        if (error) throw new Error(`${table}: ${error.message}`);
        rows.push(...(data ?? []));
        if ((data?.length ?? 0) < 1000) break;
      }
      tables[table] = rows;
      totalRows += rows.length;
    }

    const createdAt = new Date().toISOString();
    const payload = JSON.stringify({
      version: "public-table-json-gzip-v1",
      createdAt,
      tables,
    });
    const compressed = gzipSync(payload, { level: 9 });
    const sha256 = createHash("sha256").update(compressed).digest("hex");
    const fileName = `${createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.json.gz`;

    await ensurePrivateBucket();
    const { error: uploadError } = await admin.storage
      .from(BACKUP_BUCKET)
      .upload(fileName, compressed, {
        contentType: "application/gzip",
        upsert: false,
        metadata: { sha256, totalRows },
      });
    if (uploadError) throw new Error(`Upload backup: ${uploadError.message}`);

    const removedFiles = await removeExpiredBackups();
    return NextResponse.json({
      ok: true,
      createdAt,
      fileName,
      tables: TABLES.length,
      totalRows,
      compressedBytes: compressed.byteLength,
      sha256,
      removedFiles,
      retentionDays: RETENTION_DAYS,
    });
  } catch (error) {
    console.error("production_backup_failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Backup failed" },
      { status: 500 },
    );
  }
}
