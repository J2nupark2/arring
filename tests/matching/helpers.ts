import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Browser, BrowserContext, Page } from "@playwright/test";

type PartySize = 5 | 10;

export type TestUser = {
  id: string;
  email: string;
  password: string;
  characterId: string;
  className: string;
  context: BrowserContext;
  page: Page;
};

export type PartyHarness = {
  admin: SupabaseClient;
  runId: string;
  dungeonId: string;
  leader: TestUser;
  members: TestUser[];
  users: TestUser[];
  startedAt: string;
  dispose: () => Promise<void>;
};

function loadLocalEnv() {
  const envPath = resolve(process.cwd(), ".env.local");
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

loadLocalEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Playwright matching tests require Supabase environment variables.");
}

export const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function must<T>(label: string, operation: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await operation;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/\/party(?:\?|$)/);
}

export async function createPartyHarness(browser: Browser, size: PartySize): Promise<PartyHarness> {
  const runId = `pw-${size}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = `Arring-${Date.now()}!`;
  const category = size === 10 ? "성역" : "원정";
  const dungeon = await must(
    "create isolated dungeon",
    admin
      .from("dungeons")
      .insert({
        category,
        name: `${runId} dungeon`,
        gimmick_stages: ["1", "2", "3"],
        sort_order: 999999,
        is_active: false,
      })
      .select("id")
      .single(),
  ) as { id: string };

  const users: TestUser[] = [];
  try {
    for (let index = 0; index < size; index++) {
      const role = index === 0 ? "leader" : `member-${index}`;
      const email = `${runId}-${role}@example.test`;
      const className = ["검성", "수호성", "살성", "궁성", "마도성", "정령성", "치유성", "호법성", "사격성", "기갑성"][index];
      const auth = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nickname: `${runId}-${role}`, server: "테스트" },
      });
      if (auth.error || !auth.data.user) {
        throw new Error(`create ${role}: ${auth.error?.message ?? "missing user"}`);
      }
      const userId = auth.data.user.id;
      await must(
        `update ${role} profile`,
        admin.from("profiles").update({
          nickname: `${runId}-${role}`,
          server: "테스트",
          manner_temperature: 50,
          trust_temperature: 50,
        }).eq("id", userId).select("id").single(),
      );
      const character = await must(
        `create ${role} character`,
        admin.from("aion2_characters").insert({
          user_id: userId,
          character_id: `${runId}-${index}`,
          character_name: `${runId}-${role}`,
          server_id: 9999,
          server_name: "테스트",
          class_name: className,
          character_level: 55,
          combat_power: 800_000 - index * 1_000,
          is_primary: true,
        }).select("id").single(),
      ) as { id: string };
      const context = await browser.newContext();
      const page = await context.newPage();
      await login(page, email, password);
      users.push({ id: userId, email, password, characterId: character.id, className, context, page });
    }
  } catch (error) {
    await Promise.all(users.map((user) => user.context.close()));
    for (const user of users) await admin.auth.admin.deleteUser(user.id);
    await admin.from("dungeons").delete().eq("id", dungeon.id);
    throw error;
  }

  const dispose = async () => {
    await Promise.all(users.map((user) => user.context.close().catch(() => undefined)));
    await Promise.race([
      Promise.allSettled(users.map((user) => admin.auth.admin.deleteUser(user.id))),
      new Promise((resolve) => setTimeout(resolve, 30_000)),
    ]);
    await Promise.race([
      admin.from("dungeons").delete().eq("id", dungeon.id),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  };

  return {
    admin,
    runId,
    dungeonId: dungeon.id,
    leader: users[0],
    members: users.slice(1),
    users,
    startedAt: new Date().toISOString(),
    dispose,
  };
}

export async function createReplacementUser(
  harness: PartyHarness,
  browser: Browser,
  className: string,
) {
  const role = `replacement-${Date.now()}`;
  const email = `${harness.runId}-${role}@example.test`;
  const password = `Arring-${Date.now()}!`;
  const auth = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nickname: `${harness.runId}-${role}`, server: "테스트" },
  });
  if (auth.error || !auth.data.user) {
    throw new Error(`create replacement: ${auth.error?.message ?? "missing user"}`);
  }
  const userId = auth.data.user.id;
  await must(
    "update replacement profile",
    admin
      .from("profiles")
      .update({
        nickname: `${harness.runId}-${role}`,
        server: "테스트",
        manner_temperature: 50,
        trust_temperature: 50,
      })
      .eq("id", userId)
      .select("id")
      .single(),
  );
  const character = (await must(
    "create replacement character",
    admin
      .from("aion2_characters")
      .insert({
        user_id: userId,
        character_id: `${harness.runId}-${role}`,
        character_name: `${harness.runId}-${role}`,
        server_id: 9999,
        server_name: "테스트",
        class_name: className,
        character_level: 55,
        combat_power: 790_000,
        is_primary: true,
      })
      .select("id")
      .single(),
  )) as { id: string };
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email, password);
  const replacement: TestUser = {
    id: userId,
    email,
    password,
    characterId: character.id,
    className,
    context,
    page,
  };
  harness.users.push(replacement);
  return replacement;
}

async function matchingApi(user: TestUser, method: string, body?: object) {
  const response = await user.context.request.fetch("/api/matching", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    data: body,
  });
  const data = await response.json();
  if (!response.ok()) throw new Error(`${method} matching failed: ${response.status()} ${JSON.stringify(data)}`);
  return data as Record<string, unknown>;
}

export async function queueParty(harness: PartyHarness, options?: {
  stage?: number;
  minCombatPower?: number;
  requiredClasses?: string[];
}) {
  const stage = options?.stage ?? 3;
  for (const member of harness.members) {
    await matchingApi(member, "POST", {
      role: "member",
      dungeonId: harness.dungeonId,
      characterId: member.characterId,
      stage,
    });
  }
  const result = await matchingApi(harness.leader, "POST", {
    role: "leader",
    dungeonId: harness.dungeonId,
    characterId: harness.leader.characterId,
    stage,
    minCombatPower: options?.minCombatPower ?? 700_000,
    requiredClasses: options?.requiredClasses ?? harness.members.map((member) => member.className),
  });
  const temporaryMatch = result.temporaryMatch as { id?: string } | undefined;
  if (!temporaryMatch?.id) throw new Error(`temporary match was not created: ${JSON.stringify(result)}`);
  await Promise.all(harness.users.map(async (user) => {
    await user.page.goto("/party");
    await user.page.getByText("매칭 수락 대기 중").waitFor();
  }));
  return temporaryMatch.id;
}

export async function acceptInUi(user: TestUser) {
  await user.page.getByRole("button", { name: /^수락$/ }).click();
}

export async function rejectInUi(user: TestUser) {
  await user.page.getByRole("button", { name: "거절" }).click();
}

export async function setTemporaryExpiry(temporaryMatchId: string, iso: string) {
  await must(
    "set temporary match expiry",
    admin.from("temporary_matches").update({ expires_at: iso }).eq("id", temporaryMatchId).select("id").single(),
  );
}

export async function waitForTemporaryStatus(
  temporaryMatchId: string,
  expectedStatus: "cancelled" | "expired",
) {
  const deadline = Date.now() + 10_000;
  let value: { status: string; room_id: string | null } | null = null;
  while (Date.now() < deadline) {
    const { data, error } = await admin
      .from("temporary_matches")
      .select("status, room_id")
      .eq("id", temporaryMatchId)
      .single();
    if (error) throw new Error(`load temporary status: ${error.message}`);
    value = data as { status: string; room_id: string | null };
    if (value.status === expectedStatus) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`expected temporary match ${expectedStatus}, got ${JSON.stringify(value)}`);
}

export async function assertSingleRoom(harness: PartyHarness, temporaryMatchId: string) {
  let temp: { room_id: string | null; status: string } | null = null;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    temp = await must(
      "load confirmed temporary match",
      admin.from("temporary_matches").select("room_id, status").eq("id", temporaryMatchId).single(),
    ) as { room_id: string | null; status: string };
    if (temp.status === "confirmed" && temp.room_id) break;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  if (!temp || temp.status !== "confirmed" || !temp.room_id) {
    throw new Error(`match not confirmed: ${JSON.stringify(temp)}`);
  }
  const rooms = await must(
    "load created room",
    admin.from("rooms").select("id, code, max_members, host_id, status").eq("id", temp.room_id),
  ) as { id: string; code: string; max_members: number; host_id: string; status: string }[];
  if (rooms.length !== 1) throw new Error(`expected one room, found ${rooms.length}`);
  const participants = await must(
    "load room participants",
    admin.from("room_participants").select("user_id").eq("room_id", temp.room_id),
  ) as { user_id: string }[];
  if (participants.length !== harness.users.length) {
    throw new Error(`expected ${harness.users.length} participants, found ${participants.length}`);
  }
  return rooms[0];
}
