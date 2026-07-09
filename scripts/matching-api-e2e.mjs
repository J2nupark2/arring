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

async function createTestUser(label = "solo", overrides = {}) {
  const email = `${runId}-${label}@example.test`;
  const nickname = `${runId}-${label}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nickname, server: "테스트" },
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
        nickname,
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
        character_id: `${runId}-${label}`,
        character_name: nickname,
        server_id: 9999,
        server_name: "테스트",
        class_name: overrides.className ?? "살성",
        character_level: 55,
        combat_power: overrides.combatPower ?? 780_000,
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

async function acceptMatch(jar) {
  return api(jar, "/api/matching", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "accept" }),
  });
}

async function testStaleQueueExpires() {
  const dungeon = await createIsolatedDungeon();
  const user = await createTestUser("stale", { combatPower: 780_000 });
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
  assert(post.ok, `stale setup POST failed: ${post.status} ${JSON.stringify(post.data)}`);
  assert(post.data?.state === "waiting", `stale setup should wait, got ${JSON.stringify(post.data)}`);

  const staleHeartbeat = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  await must(
    "age stale queue heartbeat",
    admin
      .from("match_queue")
      .update({ heartbeat_at: staleHeartbeat })
      .eq("user_id", user.userId)
      .eq("status", "waiting"),
  );

  const get = await api(jar, `/api/matching?since=${encodeURIComponent(startedAt)}`);
  assert(get.ok, `stale GET failed: ${get.status} ${JSON.stringify(get.data)}`);
  assert(
    get.data?.state === "cancelled" && get.data?.active === false,
    `stale queue should expire as cancelled, got ${JSON.stringify(get.data)}`,
  );

  console.log("[matching-api-e2e] stale member queue expires");
}

async function testMemberQueueWinsOverCancelledLeaderRequest() {
  const dungeon = await createIsolatedDungeon();
  const user = await createTestUser("member-after-leader", { combatPower: 780_000 });
  const jar = await signIn(user.email);

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
  assert(leaderPost.ok, `leader setup failed: ${leaderPost.status} ${JSON.stringify(leaderPost.data)}`);
  assert(leaderPost.data?.state === "waiting", `leader setup should wait, got ${JSON.stringify(leaderPost.data)}`);

  const memberStartedAt = new Date().toISOString();
  const memberPost = await api(jar, "/api/matching", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "member",
      dungeonId: dungeon.id,
      characterId: user.characterId,
      stage: 3,
    }),
  });
  assert(memberPost.ok, `member after leader failed: ${memberPost.status} ${JSON.stringify(memberPost.data)}`);
  assert(memberPost.data?.state === "waiting", `member after leader should wait, got ${JSON.stringify(memberPost.data)}`);

  const status = await api(jar, `/api/matching?since=${encodeURIComponent(memberStartedAt)}`);
  assert(status.ok, `member after leader status failed: ${status.status} ${JSON.stringify(status.data)}`);
  assert(
    status.data?.state === "waiting" &&
      status.data?.active === true &&
      status.data?.role === "member",
    `active member queue should not be hidden by cancelled leader request, got ${JSON.stringify(status.data)}`,
  );

  console.log("[matching-api-e2e] member queue survives cancelled leader request");
}

async function testFullHttpMatch() {
  const dungeon = await createIsolatedDungeon();
  const leader = await createTestUser("leader", { className: "검성", combatPower: 820_000 });
  const members = [
    await createTestUser("member1", { className: "호법성", combatPower: 760_000 }),
    await createTestUser("member2", { className: "치유성", combatPower: 755_000 }),
    await createTestUser("member3", { className: "마도성", combatPower: 750_000 }),
    await createTestUser("member4", { className: "궁성", combatPower: 745_000 }),
  ];
  const memberJars = [];

  await must(
    "set stale member room code",
    admin
      .from("profiles")
      .update({ current_room_code: "STALE1" })
      .eq("id", members[0].userId),
  );

  for (const member of members) {
    const jar = await signIn(member.email);
    memberJars.push(jar);
    const response = await api(jar, "/api/matching", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: "member",
        dungeonId: dungeon.id,
        characterId: member.characterId,
        stage: 3,
      }),
    });
    assert(response.ok, `member queue failed: ${response.status} ${JSON.stringify(response.data)}`);
    assert(response.data?.state === "waiting", `member should wait, got ${JSON.stringify(response.data)}`);
  }

  const leaderJar = await signIn(leader.email);
  const startedAt = new Date().toISOString();
  const leaderResponse = await api(leaderJar, "/api/matching", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "leader",
      dungeonId: dungeon.id,
      characterId: leader.characterId,
      stage: 2,
      minCombatPower: 700_000,
      requiredClasses: [],
    }),
  });
  assert(leaderResponse.ok, `leader match failed: ${leaderResponse.status} ${JSON.stringify(leaderResponse.data)}`);
  assert(
    leaderResponse.data?.temporaryMatch?.id,
    `leader should create a temporary match, got ${JSON.stringify(leaderResponse.data)}`,
  );

  for (const jar of memberJars) {
    const pending = await api(jar, `/api/matching?since=${encodeURIComponent(startedAt)}`);
    assert(pending.ok, `member pending status failed: ${pending.status} ${JSON.stringify(pending.data)}`);
    assert(
      pending.data?.temporaryMatch?.id === leaderResponse.data.temporaryMatch.id,
      `member should see temporary match ${leaderResponse.data.temporaryMatch.id}, got ${JSON.stringify(pending.data)}`,
    );
  }

  const acceptResponses = [];
  acceptResponses.push(await acceptMatch(leaderJar));
  for (const jar of memberJars) {
    acceptResponses.push(await acceptMatch(jar));
  }
  const confirmed = acceptResponses.find((response) => response.data?.matched === true);
  assert(
    confirmed?.data?.roomCode,
    `one accept response should confirm the room, got ${JSON.stringify(acceptResponses.map((item) => item.data))}`,
  );

  for (const jar of memberJars) {
    const status = await api(jar, `/api/matching?since=${encodeURIComponent(startedAt)}`);
    assert(status.ok, `member matched status failed: ${status.status} ${JSON.stringify(status.data)}`);
    assert(
      status.data?.matched === true && status.data?.roomCode === confirmed.data.roomCode,
      `member should see matched room ${confirmed.data.roomCode}, got ${JSON.stringify(status.data)}`,
    );
  }

  console.log(`[matching-api-e2e] full 5-person HTTP match room ${confirmed.data.roomCode}`);
}

async function testDummyInviteRematchCountsInvites() {
  const dungeon = await createIsolatedDungeon();
  const leader = await createTestUser("dummy-rematch-leader", { className: "검성", combatPower: 850_000 });
  const member = await createTestUser("dummy-rematch-member", { className: "치유성", combatPower: 810_000 });
  const dummies = [
    await createTestUser("dummy-rematch-invite1", { className: "수호성", combatPower: 760_000 }),
    await createTestUser("dummy-rematch-invite2", { className: "궁성", combatPower: 770_000 }),
    await createTestUser("dummy-rematch-invite3", { className: "마도성", combatPower: 780_000 }),
  ];

  for (let index = 0; index < dummies.length; index++) {
    await must(
      "mark rematch dummy profile",
      admin
        .from("profiles")
        .update({ nickname: `더미친구재매칭${index + 1}` })
        .eq("id", dummies[index].userId),
    );
    await must(
      "create rematch dummy friendship",
      admin.from("friend_requests").insert({
        sender_id: leader.userId,
        receiver_id: dummies[index].userId,
        status: "accepted",
        responded_at: new Date().toISOString(),
      }),
    );
  }

  const memberJar = await signIn(member.email);
  const memberPost = await api(memberJar, "/api/matching", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "member",
      dungeonId: dungeon.id,
      characterId: member.characterId,
      stage: 3,
    }),
  });
  assert(memberPost.ok, `rematch member queue failed: ${memberPost.status} ${JSON.stringify(memberPost.data)}`);

  const leaderJar = await signIn(leader.email);
  const startedAt = new Date().toISOString();
  const leaderPost = await api(leaderJar, "/api/matching", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "leader",
      dungeonId: dungeon.id,
      characterId: leader.characterId,
      stage: 2,
      minCombatPower: 700_000,
      requiredClasses: [],
      invitedFriendIds: dummies.map((dummy) => dummy.userId),
    }),
  });
  assert(leaderPost.ok, `rematch leader failed: ${leaderPost.status} ${JSON.stringify(leaderPost.data)}`);
  assert(leaderPost.data?.temporaryMatch?.id, `rematch should start temporary, got ${JSON.stringify(leaderPost.data)}`);

  const reject = await api(memberJar, "/api/matching", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "reject" }),
  });
  assert(reject.ok, `member reject failed: ${reject.status} ${JSON.stringify(reject.data)}`);

  const rematch = await api(leaderJar, `/api/matching?since=${encodeURIComponent(startedAt)}`);
  assert(rematch.ok, `leader rematch status failed: ${rematch.status} ${JSON.stringify(rematch.data)}`);
  assert(
    rematch.data?.temporaryMatch?.id &&
      rematch.data.temporaryMatch.id !== leaderPost.data.temporaryMatch.id,
    `leader polling should create a new temporary rematch, got ${JSON.stringify(rematch.data)}`,
  );
  assert(
    rematch.data.temporaryMatch.responses.filter((row) => row.status === "accepted").length === 3,
    `rematch should count invited dummies as accepted, got ${JSON.stringify(rematch.data)}`,
  );

  console.log("[matching-api-e2e] dummy invites count on automatic rematch");
}

async function testDummyInvitesAutoAccept() {
  const dungeon = await createIsolatedDungeon();
  const leader = await createTestUser("dummy-leader", { className: "검성", combatPower: 850_000 });
  const member = await createTestUser("dummy-member", { className: "치유성", combatPower: 810_000 });
  const dummies = [
    await createTestUser("dummy-invite1", { className: "수호성", combatPower: 760_000 }),
    await createTestUser("dummy-invite2", { className: "궁성", combatPower: 770_000 }),
    await createTestUser("dummy-invite3", { className: "마도성", combatPower: 780_000 }),
  ];

  for (let index = 0; index < dummies.length; index++) {
    await must(
      "mark dummy profile",
      admin
        .from("profiles")
        .update({ nickname: `더미친구테스트${index + 1}` })
        .eq("id", dummies[index].userId),
    );
    await must(
      "create dummy friendship",
      admin.from("friend_requests").insert({
        sender_id: leader.userId,
        receiver_id: dummies[index].userId,
        status: "accepted",
        responded_at: new Date().toISOString(),
      }),
    );
  }

  const memberJar = await signIn(member.email);
  const memberPost = await api(memberJar, "/api/matching", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "member",
      dungeonId: dungeon.id,
      characterId: member.characterId,
      stage: 3,
    }),
  });
  assert(memberPost.ok, `dummy member queue failed: ${memberPost.status} ${JSON.stringify(memberPost.data)}`);

  const leaderJar = await signIn(leader.email);
  const leaderPost = await api(leaderJar, "/api/matching", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "leader",
      dungeonId: dungeon.id,
      characterId: leader.characterId,
      stage: 2,
      minCombatPower: 700_000,
      requiredClasses: [],
      invitedFriendIds: dummies.map((dummy) => dummy.userId),
    }),
  });
  assert(leaderPost.ok, `dummy invite leader failed: ${leaderPost.status} ${JSON.stringify(leaderPost.data)}`);
  assert(
    leaderPost.data?.temporaryMatch?.responses?.filter((row) => row.status === "accepted").length === 3,
    `dummy invites should start accepted, got ${JSON.stringify(leaderPost.data)}`,
  );

  const leaderAccept = await acceptMatch(leaderJar);
  assert(leaderAccept.ok, `dummy leader accept failed: ${leaderAccept.status} ${JSON.stringify(leaderAccept.data)}`);
  const memberAccept = await acceptMatch(memberJar);
  assert(memberAccept.ok, `dummy member accept failed: ${memberAccept.status} ${JSON.stringify(memberAccept.data)}`);
  assert(
    memberAccept.data?.matched === true && memberAccept.data?.roomCode,
    `leader+member acceptance should confirm dummy invite room, got ${JSON.stringify(memberAccept.data)}`,
  );

  console.log(`[matching-api-e2e] dummy invites auto-accepted room ${memberAccept.data.roomCode}`);
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

  await testStaleQueueExpires();
  await testMemberQueueWinsOverCancelledLeaderRequest();
  await testFullHttpMatch();
  await testDummyInvitesAutoAccept();
  await testDummyInviteRematchCountsInvites();

  console.log(`[matching-api-e2e] dungeon ${dungeon.name}`);
  console.log("[matching-api-e2e] member waiting -> stale expiry -> cancelled leader ignored -> full match -> dummy auto accept/rematch -> cancel lifecycle");
  console.log("[matching-api-e2e] PASS");
} finally {
  await cleanup();
}
