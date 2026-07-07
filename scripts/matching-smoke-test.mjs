import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `codex-${Date.now()}`;
const password = `Arring-${Date.now()}!`;
const testUsers = [
  { key: "leader", nickname: `${runId}-leader`, className: "검성", combatPower: 820_000 },
  { key: "member1", nickname: `${runId}-member1`, className: "호법성", combatPower: 760_000 },
  { key: "member2", nickname: `${runId}-member2`, className: "치유성", combatPower: 755_000 },
  { key: "member3", nickname: `${runId}-member3`, className: "마도성", combatPower: 750_000 },
  { key: "member4", nickname: `${runId}-member4`, className: "궁성", combatPower: 745_000 },
  { key: "requeue", nickname: `${runId}-requeue`, className: "살성", combatPower: 735_000 },
];

const createdUsers = [];
const createdDungeons = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function must(label, promise) {
  const { data, error, count } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return { data, count };
}

async function createIsolatedDungeon() {
  const { data: template } = await must(
    "load dungeon category",
    admin
      .from("dungeons")
      .select("category")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle(),
  );
  assert(template?.category, "No active dungeon category exists for matching test.");

  const { data: dungeon } = await must(
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
      .select("id, name, category")
      .single(),
  );
  createdDungeons.push(dungeon.id);
  return dungeon;
}

async function createAuthUser(user) {
  const email = `${user.nickname}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      nickname: user.nickname,
      server: "테스트",
    },
  });
  if (error) throw new Error(`create auth user ${user.key}: ${error.message}`);
  const id = data.user?.id;
  assert(id, `create auth user ${user.key}: missing id`);
  createdUsers.push(id);

  await must(
    `update profile ${user.key}`,
    admin
      .from("profiles")
      .update({
        nickname: user.nickname,
        server: "테스트",
        manner_temperature: 40,
        trust_temperature: 40,
      })
      .eq("id", id),
  );

  const { data: character } = await must(
    `create character ${user.key}`,
    admin
      .from("aion2_characters")
      .insert({
        user_id: id,
        character_id: `${runId}-${user.key}`,
        character_name: user.nickname,
        server_id: 9999,
        server_name: "테스트",
        class_name: user.className,
        character_level: 55,
        combat_power: user.combatPower,
        is_primary: true,
      })
      .select("id")
      .single(),
  );

  return { ...user, id, email, characterId: character.id };
}

async function createQueue(user, dungeonId, stage = 3) {
  const { data } = await must(
    `queue ${user.key}`,
    admin
      .from("match_queue")
      .insert({
        user_id: user.id,
        dungeon_id: dungeonId,
        character_row_id: user.characterId,
        requested_stage: stage,
        status: "waiting",
      })
      .select("id, created_at, status")
      .single(),
  );
  return data;
}

async function latestQueueState(userId) {
  const { data } = await must(
    "latest queue state",
    admin
      .from("match_queue")
      .select("id, status, created_at")
      .eq("user_id", userId)
      .in("status", ["waiting", "cancelled"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  );
  return data;
}

async function completeFivePersonMatch({ leader, members, dungeonId }) {
  for (const member of members) {
    await createQueue(member, dungeonId);
  }

  const { data: request } = await must(
    "create leader request",
    admin
      .from("match_requests")
      .insert({
        leader_id: leader.id,
        dungeon_id: dungeonId,
        character_row_id: leader.characterId,
        required_stage: 2,
        min_combat_power: 700_000,
        required_classes: [],
        max_members: 5,
        status: "waiting",
      })
      .select("id, created_at")
      .single(),
  );

  const { data: claimed } = await must(
    "claim request",
    admin
      .from("match_requests")
      .update({ status: "processing" })
      .eq("id", request.id)
      .eq("status", "waiting")
      .select("id")
      .maybeSingle(),
  );
  assert(claimed?.id === request.id, "request was not claimed exactly once");

  const { data: candidates } = await must(
    "load candidates",
    admin
      .from("match_queue")
      .select("id, user_id, character_row_id, requested_stage")
      .eq("status", "waiting")
      .eq("dungeon_id", dungeonId)
      .gte("requested_stage", 2)
      .order("created_at", { ascending: true })
      .limit(10),
  );
  assert(candidates.length >= 4, `expected at least 4 candidates, got ${candidates.length}`);

  const chosen = candidates.slice(0, 4);
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const roomCode = `T${String(Date.now()).slice(-5)}`;
  const { data: room } = await must(
    "create matched room",
    admin
      .from("rooms")
      .insert({
        code: roomCode,
        title: `${runId} smoke room`,
        max_members: 5,
        is_public: false,
        created_by: leader.id,
        host_id: leader.id,
        expires_at: expiresAt,
      })
      .select("id, code")
      .single(),
  );

  await must(
    "insert participants",
    admin.from("room_participants").insert(
      [leader.id, ...chosen.map((item) => item.user_id)].map((user_id) => ({
        room_id: room.id,
        user_id,
      })),
    ),
  );

  await must(
    "mark request matched",
    admin
      .from("match_requests")
      .update({
        status: "matched",
        room_id: room.id,
        matched_at: new Date().toISOString(),
      })
      .eq("id", request.id)
      .eq("status", "processing"),
  );

  await must(
    "mark queues matched",
    admin
      .from("match_queue")
      .update({
        status: "matched",
        match_request_id: request.id,
        room_id: room.id,
        matched_at: new Date().toISOString(),
      })
      .in("id", chosen.map((item) => item.id))
      .eq("status", "waiting"),
  );

  const { count: participantCount } = await must(
    "count room participants",
    admin
      .from("room_participants")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id),
  );
  assert(participantCount === 5, `expected 5 room participants, got ${participantCount}`);

  const { count: matchedQueueCount } = await must(
    "count matched queues",
    admin
      .from("match_queue")
      .select("id", { count: "exact", head: true })
      .eq("match_request_id", request.id)
      .eq("status", "matched"),
  );
  assert(matchedQueueCount === 4, `expected 4 matched queues, got ${matchedQueueCount}`);

  return room;
}

async function testCancelAndRequeue(user, dungeonId) {
  const firstQueue = await createQueue(user, dungeonId);
  let state = await latestQueueState(user.id);
  assert(state?.status === "waiting", "queue should be waiting after insert");

  await must(
    "cancel waiting queue",
    admin
      .from("match_queue")
      .update({ status: "cancelled" })
      .eq("id", firstQueue.id)
      .eq("status", "waiting"),
  );
  state = await latestQueueState(user.id);
  assert(state?.status === "cancelled", "queue should be cancelled after cancel");

  await createQueue(user, dungeonId);
  state = await latestQueueState(user.id);
  assert(state?.status === "waiting", "queue should be waiting after requeue");

  await must(
    "cancel requeued queue without unique collision",
    admin
      .from("match_queue")
      .update({ status: "cancelled" })
      .eq("user_id", user.id)
      .eq("status", "waiting"),
  );
  state = await latestQueueState(user.id);
  assert(state?.status === "cancelled", "requeued queue should cancel cleanly");
}

async function cleanup() {
  for (const id of createdUsers.reverse()) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      console.warn(`cleanup failed for ${id}: ${error.message}`);
    }
  }
  for (const id of createdDungeons.reverse()) {
    const { error } = await admin.from("dungeons").delete().eq("id", id);
    if (error) {
      console.warn(`dungeon cleanup failed for ${id}: ${error.message}`);
    }
  }
}

try {
  console.log(`[matching-smoke] run ${runId}`);
  const dungeon = await createIsolatedDungeon();
  console.log(`[matching-smoke] dungeon ${dungeon.name} (${dungeon.id})`);

  const users = {};
  for (const testUser of testUsers) {
    users[testUser.key] = await createAuthUser(testUser);
  }
  console.log("[matching-smoke] created test users and characters");

  const room = await completeFivePersonMatch({
    leader: users.leader,
    members: [users.member1, users.member2, users.member3, users.member4],
    dungeonId: dungeon.id,
  });
  console.log(`[matching-smoke] matched 5-person room ${room.code}`);

  await testCancelAndRequeue(users.requeue, dungeon.id);
  console.log("[matching-smoke] cancel and requeue lifecycle passed");

  console.log("[matching-smoke] PASS");
} finally {
  await cleanup();
}
