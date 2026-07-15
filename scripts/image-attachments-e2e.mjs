import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const root = resolve(process.cwd());
for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match || process.env[match[1]]) continue;
  process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const baseUrl = process.env.IMAGE_HTTP_BASE_URL ?? "http://localhost:3000";
if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("Supabase env vars are required.");

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const runId = `image-e2e-${Date.now()}`;
const password = `Arring-${crypto.randomUUID()}!`;
const userIds = [];
const imagePaths = [];
let roomId = null;

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

async function createUser(label, isAdmin = false) {
  const email = `${runId}-${label}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nickname: `${runId}-${label}` },
  });
  if (error || !data.user) throw new Error(`create ${label}: ${error?.message}`);
  userIds.push(data.user.id);
  await must(
    `profile ${label}`,
    admin
      .from("profiles")
      .update({ nickname: `${runId}-${label}`, is_admin: isAdmin })
      .eq("id", data.user.id),
  );

  const jar = createCookieJar();
  const client = createServerClient(supabaseUrl, anonKey, {
    cookies: { getAll: jar.getAll, setAll: jar.setAll },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`sign in ${label}: ${signInError.message}`);
  return { id: data.user.id, jar, client };
}

async function api(user, path, init = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Cookie: user.jar.header() },
  });
}

const png = new Blob([
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zt9sAAAAASUVORK5CYII=",
    "base64",
  ),
], { type: "image/png" });

async function upload(user, context, values = {}, file = png) {
  const form = new FormData();
  form.set("context", context);
  form.set("file", file, "test.png");
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  const response = await api(user, "/api/images", { method: "POST", body: form });
  const data = await response.json().catch(() => ({}));
  assert(response.status === 201, `upload ${context}: ${response.status} ${JSON.stringify(data)}`);
  imagePaths.push(data.path);
  return data.path;
}

async function imageStatus(user, path) {
  const response = await api(user, `/api/images?path=${encodeURIComponent(path)}`);
  return { status: response.status, type: response.headers.get("content-type") };
}

async function run() {
  const sender = await createUser("sender");
  const receiver = await createUser("receiver");
  const moderator = await createUser("admin", true);

  await must(
    "friendship",
    admin.from("friend_requests").insert({
      sender_id: sender.id,
      receiver_id: receiver.id,
      status: "accepted",
      responded_at: new Date().toISOString(),
    }),
  );

  const inquiryPath = await upload(sender, "inquiry");
  const inquiryResponse = await api(sender, "/api/inquiries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: "bug",
      subject: `${runId} inquiry`,
      message: "이미지 문의 첨부를 확인하는 자동 테스트 내용입니다.",
      imagePath: inquiryPath,
    }),
  });
  assert(inquiryResponse.status === 201, `inquiry create: ${inquiryResponse.status}`);
  const inquiry = (await inquiryResponse.json()).inquiry;
  assert(inquiry.image_path === inquiryPath, "inquiry did not persist image path");
  assert((await imageStatus(sender, inquiryPath)).status === 200, "owner cannot read inquiry image");
  assert((await imageStatus(receiver, inquiryPath)).status === 403, "other user read inquiry image");
  const adminInquiryImage = await imageStatus(moderator, inquiryPath);
  assert(adminInquiryImage.status === 200 && adminInquiryImage.type === "image/png", "admin cannot read inquiry image");

  const dmPath = await upload(sender, "direct-message", { otherUserId: receiver.id });
  const dm = await must(
    "send image message",
    sender.client
      .rpc("send_message", {
        p_receiver_id: receiver.id,
        p_body: "",
        p_image_path: dmPath,
      })
      .single(),
  );
  assert(dm.image_path === dmPath, "direct message did not persist image path");
  const received = await must(
    "list image messages",
    receiver.client.rpc("list_messages", { other_user_id: sender.id }),
  );
  assert(received.some((message) => message.image_path === dmPath), "receiver did not list image message");
  assert((await imageStatus(receiver, dmPath)).status === 200, "receiver cannot read DM image");
  assert((await imageStatus(moderator, dmPath)).status === 403, "unrelated admin read DM image");
  const textOnly = await must(
    "send text-only message",
    sender.client
      .rpc("send_message", {
        p_receiver_id: receiver.id,
        p_body: "text-only regression check",
      })
      .single(),
  );
  assert(textOnly.body === "text-only regression check" && !textOnly.image_path, "text-only DM regressed");

  roomId = await must(
    "create room",
    sender.client.rpc("create_room", {
      p_code: crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase(),
      p_title: `${runId} room`,
      p_max_members: 5,
      p_is_public: false,
      p_password: null,
      p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }),
  );
  await must(
    "room participants",
    admin.from("room_participants").insert([
      { room_id: roomId, user_id: sender.id },
      { room_id: roomId, user_id: receiver.id },
    ]),
  );
  const roomPath = await upload(sender, "room", { roomId });
  assert((await imageStatus(receiver, roomPath)).status === 200, "room participant cannot read image");
  assert((await imageStatus(moderator, roomPath)).status === 403, "room outsider read image");

  const fakeForm = new FormData();
  fakeForm.set("context", "inquiry");
  fakeForm.set("file", new Blob(["not an image"], { type: "image/png" }), "fake.png");
  const fakeResponse = await api(sender, "/api/images", { method: "POST", body: fakeForm });
  assert(fakeResponse.status === 415, `fake image was accepted: ${fakeResponse.status}`);

  console.log(JSON.stringify({
    ok: true,
    inquiry: "owner/admin allowed, unrelated user blocked",
    directMessage: "friend recipient allowed, unrelated admin blocked",
    room: "participant allowed, outsider blocked",
    spoofedMime: "blocked",
  }, null, 2));
}

try {
  await run();
} finally {
  if (imagePaths.length) await admin.storage.from("private-chat-images").remove(imagePaths);
  if (roomId) await admin.from("rooms").delete().eq("id", roomId);
  for (const userId of userIds.reverse()) await admin.auth.admin.deleteUser(userId);
}
