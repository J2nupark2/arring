import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "production-backups";
const EXPECTED_TABLES = [
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
  "support_inquiries",
  "temporary_matches",
  "user_gimmick_trust_scores",
];

const root = resolve(process.cwd());
try {
  const envText = await readFile(resolve(root, ".env.local"), "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("Supabase environment variables are required.");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: files, error: listError } = await admin.storage.from(BUCKET).list("", {
  limit: 100,
  sortBy: { column: "created_at", order: "desc" },
});
if (listError) throw new Error(`List backups: ${listError.message}`);

const latest = files?.find((file) => file.name.endsWith(".json.gz"));
if (!latest) throw new Error("No automatic backup file was found.");

const { data: blob, error: downloadError } = await admin.storage
  .from(BUCKET)
  .download(latest.name);
if (downloadError) throw new Error(`Download backup: ${downloadError.message}`);

const compressed = Buffer.from(await blob.arrayBuffer());
const sha256 = createHash("sha256").update(compressed).digest("hex");
const hashFileName = `${latest.name}.sha256`;
const { data: hashBlob, error: hashDownloadError } = await admin.storage
  .from(BUCKET)
  .download(hashFileName);
if (hashDownloadError) {
  throw new Error(`Download backup hash: ${hashDownloadError.message}`);
}
const hashContents = await hashBlob.text();
const storedSha256 = hashContents.trim().split(/\s+/)[0];
if (!/^[a-f0-9]{64}$/.test(storedSha256)) {
  throw new Error("Stored SHA-256 file is invalid.");
}
if (storedSha256 !== sha256) {
  throw new Error(`SHA-256 mismatch: expected ${storedSha256}, received ${sha256}`);
}

let backup;
try {
  backup = JSON.parse(gunzipSync(compressed).toString("utf8"));
} catch (error) {
  throw new Error(
    `Backup is not valid gzip JSON: ${error instanceof Error ? error.message : error}`,
  );
}

if (backup?.version !== "public-table-json-gzip-v1") {
  throw new Error(`Unsupported backup version: ${String(backup?.version)}`);
}
if (!backup.createdAt || Number.isNaN(Date.parse(backup.createdAt))) {
  throw new Error("Backup createdAt is missing or invalid.");
}
if (!backup.tables || typeof backup.tables !== "object" || Array.isArray(backup.tables)) {
  throw new Error("Backup tables payload is invalid.");
}

const actualTables = Object.keys(backup.tables).sort();
const expectedTables = [...EXPECTED_TABLES].sort();
const missingTables = expectedTables.filter((table) => !actualTables.includes(table));
const unexpectedTables = actualTables.filter((table) => !expectedTables.includes(table));
if (missingTables.length || unexpectedTables.length) {
  throw new Error(
    `Table mismatch. Missing: ${missingTables.join(", ") || "none"}; unexpected: ${unexpectedTables.join(", ") || "none"}`,
  );
}

const rowCounts = {};
for (const table of EXPECTED_TABLES) {
  if (!Array.isArray(backup.tables[table])) {
    throw new Error(`${table} is not an array.`);
  }
  rowCounts[table] = backup.tables[table].length;
}

const totalRows = Object.values(rowCounts).reduce((sum, count) => sum + count, 0);
const outputDir = resolve(root, ".backups", "verified");
await mkdir(outputDir, { recursive: true });
await writeFile(resolve(outputDir, latest.name), compressed);
const report = {
  verifiedAt: new Date().toISOString(),
  fileName: latest.name,
  createdAt: backup.createdAt,
  compressedBytes: compressed.byteLength,
  sha256,
  storedSha256,
  tables: EXPECTED_TABLES.length,
  totalRows,
  rowCounts,
};
await writeFile(
  resolve(outputDir, `${latest.name}.verification.json`),
  JSON.stringify(report, null, 2),
  "utf8",
);

console.log(JSON.stringify({ ok: true, ...report }, null, 2));
