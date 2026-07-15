import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = process.env.CHARACTER_HTTP_BASE_URL ?? "http://localhost:3000";
if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("Supabase env vars are required.");

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const runId = `character-unlink-${Date.now()}`;
const password = `Arring-${crypto.randomUUID()}!`;
let userId = null;

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
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    setAll(cookies) {
      for (const { name, value, options } of cookies) {
        if (options?.maxAge === 0 || value === "") jar.delete(name);
        else jar.set(name, value);
      }
    },
    header: () =>
      [...jar.entries()]
        .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
        .join("; "),
  };
}

async function removeCharacter(jar, id) {
  const response = await fetch(`${baseUrl}/api/aion2/unlink`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Cookie: jar.header(),
    },
    body: JSON.stringify({ id }),
  });
  return {
    status: response.status,
    data: await response.json().catch(() => ({})),
  };
}

async function insertCharacter(values) {
  return must(
    `insert ${values.character_name}`,
    admin
      .from("aion2_characters")
      .insert({
        user_id: userId,
        character_id: `${runId}-${values.character_name}`,
        character_name: values.character_name,
        server_id: values.server_id,
        server_name: values.server_name,
        class_name: values.class_name,
        character_level: 55,
        combat_power: values.combat_power,
        is_primary: values.is_primary,
        synced_at: values.synced_at,
      })
      .select("id, character_id")
      .single(),
  );
}

async function run() {
  const email = `${runId}@example.test`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nickname: runId },
  });
  if (error || !created.user) throw new Error(`create user: ${error?.message}`);
  userId = created.user.id;

  const jar = createCookieJar();
  const client = createServerClient(supabaseUrl, anonKey, {
    cookies: { getAll: jar.getAll, setAll: jar.setAll },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`sign in: ${signInError.message}`);

  const older = new Date(Date.now() - 60_000).toISOString();
  const newer = new Date().toISOString();
  const primary = await insertCharacter({
    character_name: "Primary",
    server_id: 9101,
    server_name: "기존",
    class_name: "검성",
    combat_power: 700_000,
    is_primary: true,
    synced_at: older,
  });
  let secondary = await insertCharacter({
    character_name: "Secondary",
    server_id: 9102,
    server_name: "승계",
    class_name: "치유성",
    combat_power: 800_000,
    is_primary: false,
    synced_at: newer,
  });
  await must(
    "seed profile snapshot",
    admin
      .from("profiles")
      .update({
        server: "기존",
        char_class: "검성",
        combat_power: 700_000,
        aion2_character_id: primary.character_id,
        aion2_character_name: "Primary",
        aion2_server_id: 9101,
        aion2_synced_at: older,
      })
      .eq("id", userId),
  );

  const secondaryDelete = await removeCharacter(jar, secondary.id);
  assert(secondaryDelete.status === 200, `secondary delete: ${secondaryDelete.status}`);
  const primaryAfterSecondaryDelete = await must(
    "primary remains",
    admin.from("aion2_characters").select("id, is_primary").eq("id", primary.id).single(),
  );
  assert(primaryAfterSecondaryDelete.is_primary, "deleting secondary changed primary");

  secondary = await insertCharacter({
    character_name: "Replacement",
    server_id: 9103,
    server_name: "신규",
    class_name: "궁성",
    combat_power: 850_000,
    is_primary: false,
    synced_at: newer,
  });
  const primaryDelete = await removeCharacter(jar, primary.id);
  assert(primaryDelete.status === 200, `primary delete: ${primaryDelete.status}`);
  const replacement = await must(
    "replacement promoted",
    admin.from("aion2_characters").select("is_primary").eq("id", secondary.id).single(),
  );
  assert(replacement.is_primary, "replacement was not promoted");
  const promotedProfile = await must(
    "profile promoted",
    admin
      .from("profiles")
      .select("server, char_class, combat_power, aion2_character_name")
      .eq("id", userId)
      .single(),
  );
  assert(
    promotedProfile.server === "신규" &&
      promotedProfile.char_class === "궁성" &&
      promotedProfile.combat_power === 850_000 &&
      promotedProfile.aion2_character_name === "Replacement",
    "profile snapshot did not follow promoted character",
  );

  const dungeon = await must(
    "active dungeon",
    admin.from("dungeons").select("id").eq("is_active", true).limit(1).single(),
  );
  const queue = await must(
    "active queue",
    admin
      .from("match_queue")
      .insert({
        user_id: userId,
        dungeon_id: dungeon.id,
        requested_stage: 0,
        status: "waiting",
        character_row_id: secondary.id,
      })
      .select("id")
      .single(),
  );
  const blockedDelete = await removeCharacter(jar, secondary.id);
  assert(blockedDelete.status === 409, `active matching delete was not blocked: ${blockedDelete.status}`);
  await must("cancel queue", admin.from("match_queue").update({ status: "cancelled" }).eq("id", queue.id));

  const otherProfile = await must(
    "invite receiver",
    admin.from("profiles").select("id").neq("id", userId).limit(1).single(),
  );
  await must(
    "stale invite draft",
    admin.from("matching_invites").insert({
      sender_id: userId,
      receiver_id: otherProfile.id,
      match_request_id: null,
      draft_id: `${runId}-draft`,
      dungeon_id: dungeon.id,
      character_row_id: secondary.id,
      status: "accepted",
      responded_at: new Date().toISOString(),
    }),
  );

  const lastDelete = await removeCharacter(jar, secondary.id);
  assert(lastDelete.status === 200, `last delete: ${lastDelete.status}`);
  const remaining = await must(
    "no linked characters",
    admin.from("aion2_characters").select("id").eq("user_id", userId),
  );
  assert(remaining.length === 0, "linked character row remained");
  const clearedProfile = await must(
    "profile cleared",
    admin
      .from("profiles")
      .select("server, char_class, combat_power, aion2_character_id, aion2_character_name")
      .eq("id", userId)
      .single(),
  );
  assert(
    Object.values(clearedProfile).every((value) => value === null),
    "last character profile fields were not cleared",
  );

  console.log(JSON.stringify({
    ok: true,
    secondaryDelete: "primary preserved",
    primaryDelete: "newest character promoted",
    activeMatching: "delete blocked",
    staleInviteDraft: "does not block delete",
    lastCharacter: "profile snapshot cleared",
  }, null, 2));
}

try {
  await run();
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
}
