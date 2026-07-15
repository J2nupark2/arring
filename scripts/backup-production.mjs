import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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

const tables = [
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
];

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const backupDir = resolve(root, ".backups", stamp);
await mkdir(backupDir, { recursive: true });

const manifest = {
  createdAt: new Date().toISOString(),
  projectRef: new URL(url).hostname.split(".")[0],
  format: "public-table-json-v1",
  files: [],
};

for (const table of tables) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin
      .from(table)
      .select("*")
      .range(offset, offset + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }

  const contents = JSON.stringify(rows);
  const file = `${table}.json`;
  await writeFile(resolve(backupDir, file), contents, "utf8");
  manifest.files.push({
    file,
    rows: rows.length,
    bytes: Buffer.byteLength(contents),
    sha256: createHash("sha256").update(contents).digest("hex"),
  });
}

await writeFile(
  resolve(backupDir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
  "utf8",
);
console.log(`Backup created: ${backupDir}`);
