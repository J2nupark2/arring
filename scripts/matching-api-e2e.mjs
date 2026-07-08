import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const root = resolve(process.cwd());
const envPath = resolve(root, ".env.local");

for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) continue;
  const [, key, rawValue] = match;
  if (process.env[key]) continue;
  process.env[key] = rawValue.replace(/^["']|["']$/g, "");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = process.env.MATCHING_HTTP_BASE_URL ?? "http://localhost:3000";

if (!url || !anonKey || !serviceKey) {
  throw new Error("Supabase env vars are required.");
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `codex-api-${Date.now()}`;
const password = `Arring-${Date.now()}!`;
const createdUsers = [];
const createdDungeons = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

function createCookieJar() {
  const jar = new Map();
  return {
    getAll() {
      return [...jar.entries()].map(([name, value]) => ({ name, value }));
    },
    setAll(cookiesToSet) {
      for (const { name, value, options } of cookiesToSet) {
        if (options?.maxAge === 0 || value === "") {
          jar.delete(name);
        } else {
          jar.set(name, value);
        }
      }
    },
    header() {
      return [...jar.entries()]
        .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
        .join("; ");
    },
  };
}

async function createTestUser() {
  const email = `${runId}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nickname: runId, server: "테스트" },
  });
  if (error) throw new Error(`create auth user: ${error.message}`);
  const userId = data.user?.id;
  assert(userId, "missing created user id");
  createdUsers.push(userId);

  await must(
    "update profile",
    admin
      .from("profiles")
      .update({
        nickname: runId,
        server: "테스트",
        manner_temperature: 40,
        trust_temperature: 40,
      })
      .eq("id", userId),
  );

  const character = await must(
    "create character",
    admin
      .from("aion2_characters")
      .insert({
        user_id: userId,
        character_id: runId,
        character_name: runId,
        server_id: 9999,
        server_name: "테스트",
        class_name: "살성",
        character_level: 55,
        combat_power: 780_000,
        is_primary: true,
      })
      .select("id")
      .single(),
  );

  return { email, userId, characterId: character.id };
}

async function createIsolatedDungeon() {
  const template = await must(
    "load dungeon category",
    admin
      .from("dungeons")
      .select("category")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle(),
  );
  assert(template?.category, "No active dungeon category exists.");

  const dungeon = await must(
    "create isolated dungeon",
    admin
      .from("dungeons")
      .insert({
        category: template.category,
        name: `${runId} dungeon`,
        gimmick_stages: ["1", "2", "3"],
        sort_order: 999999,
        is_active: false,
      })
      .select("id, name")
      .single(),
  );
  createdDungeons.push(dungeon.id);
  return dungeon;
}

async function signIn(email) {
  const jar = createCookieJar();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: jar.getAll,
      setAll: jar.setAll,
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in: ${error.message}`);
  assert(jar.header(), "sign in did not create auth cookies");
  return jar;
}

async function api(jar, path, init = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Cookie: jar.header(),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data };
}

async function cleanup() {
  for (const id of createdUsers.reverse()) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.warn(`cleanup failed for ${id}: ${error.message}`);
  }
  for (const id of createdDungeons.reverse()) {
    const { error } = await admin.from("dungeons").delete().eq("id", id);
    if (error) console.warn(`dungeon cleanup failed for ${id}: ${error.message}`);
  }
}

try {
  console.log(`[matching-api-e2e] target ${baseUrl}`);
  const health = await fetch(`${baseUrl}/party`, { redirect: "manual" });
  assert(health.status < 500, `dev server is not healthy: HTTP ${health.status}`);

  const user = await createTestUser();
  const dungeon = await createIsolatedDungeon();
  const jar = await signIn(user.email);

  const startedAt = new Date().toISOString();
  const post = await api(jar, "/api/matching", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "member",
      dungeonId: dungeon.id,
      characterId: user.characterId,
      stage: 3,
    }),
  });
  assert(post.ok, `POST /api/matching failed: ${post.status} ${JSON.stringify(post.data)}`);
  assert(post.data?.state === "waiting", `POST should return waiting, got ${JSON.stringify(post.data)}`);

  await new Promise((resolve) => setTimeout(resolve, 3500));
  const get = await api(jar, `/api/matching?since=${encodeURIComponent(startedAt)}`);
  assert(get.ok, `GET /api/matching failed: ${get.status} ${JSON.stringify(get.data)}`);
  assert(get.data?.state === "waiting" && get.data?.active === true, `GET should keep waiting active, got ${JSON.stringify(get.data)}`);

  const leaderPost = await api(jar, "/api/matching", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "leader",
      dungeonId: dungeon.id,
      characterId: user.characterId,
      stage: 2,
      minCombatPower: 700_000,
      requiredClasses: [],
    }),
  });
  assert(leaderPost.ok, `leader POST /api/matching failed: ${leaderPost.status} ${JSON.stringify(leaderPost.data)}`);
  assert(
    leaderPost.data?.state === "waiting" &&
      leaderPost.data?.role === "leader" &&
      leaderPost.data?.waitingCount === 0,
    `leader POST should not count the user's previous member queue, got ${JSON.stringify(leaderPost.data)}`,
  );

  const leaderGet = await api(jar, `/api/matching?since=${encodeURIComponent(startedAt)}`);
  assert(leaderGet.ok, `leader GET /api/matching failed: ${leaderGet.status} ${JSON.stringify(leaderGet.data)}`);
  assert(
    leaderGet.data?.state === "waiting" &&
      leaderGet.data?.role === "leader" &&
      leaderGet.data?.waitingCount === 0,
    `leader GET should show 0 eligible candidates, got ${JSON.stringify(leaderGet.data)}`,
  );

  const del = await api(jar, "/api/matching", { method: "DELETE" });
  assert(del.ok, `DELETE /api/matching failed: ${del.status} ${JSON.stringify(del.data)}`);
  assert(del.data?.state === "cancelled" && del.data?.active === false, `DELETE should return cancelled, got ${JSON.stringify(del.data)}`);

  const afterCancel = await api(jar, `/api/matching?since=${encodeURIComponent(startedAt)}`);
  assert(afterCancel.ok, `GET after cancel failed: ${afterCancel.status} ${JSON.stringify(afterCancel.data)}`);
  assert(
    afterCancel.data?.state === "cancelled" && afterCancel.data?.active === false,
    `GET after cancel should stay cancelled, got ${JSON.stringify(afterCancel.data)}`,
  );

  console.log(`[matching-api-e2e] dungeon ${dungeon.name}`);
  console.log("[matching-api-e2e] member waiting -> leader 0 candidates -> DELETE cancelled -> GET cancelled");
  console.log("[matching-api-e2e] PASS");
} finally {
  await cleanup();
}
