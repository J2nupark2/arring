import { NextRequest, NextResponse } from "next/server";

import { MAX_IMAGE_BYTES } from "@/lib/image-attachments";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BUCKET = "private-chat-images";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user && !user.is_anonymous ? user : null;
}

function hasValidSignature(bytes: Uint8Array, mime: string) {
  if (mime === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    );
  }
  if (mime === "image/webp") {
    return (
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  }
  return false;
}

function safeStoragePath(path: string) {
  return (
    path.length <= 300 &&
    !path.includes("..") &&
    !path.includes("\\") &&
    /^[a-z0-9/_\-.]+$/i.test(path)
  );
}

async function isAdmin(userId: string) {
  const { data } = await createAdminClient()
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  return data?.is_admin === true;
}

async function areFriends(userId: string, otherUserId: string) {
  const { data } = await createAdminClient()
    .from("friend_requests")
    .select("id")
    .eq("status", "accepted")
    .or(
      `and(sender_id.eq.${userId},receiver_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},receiver_id.eq.${userId})`,
    )
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

async function participatedInRoom(userId: string, roomId: string) {
  const { data } = await createAdminClient()
    .from("room_participants")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

function directMessagePair(userId: string, otherUserId: string) {
  return [userId, otherUserId].sort().join("_");
}

async function canReadPath(userId: string, path: string) {
  const parts = path.split("/");
  if (parts.length !== 3 && parts.length !== 4) return false;

  if (parts[0] === "inquiries" && parts.length === 3) {
    const { data } = await createAdminClient()
      .from("support_inquiries")
      .select("user_id")
      .eq("image_path", path)
      .limit(1)
      .maybeSingle();
    return Boolean(data && (data.user_id === userId || (await isAdmin(userId))));
  }

  if (parts[0] === "direct-messages" && parts.length === 4) {
    const { data } = await createAdminClient()
      .from("direct_messages")
      .select("id")
      .eq("image_path", path)
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .limit(1)
      .maybeSingle();
    return Boolean(data);
  }

  if (parts[0] === "rooms" && parts.length === 4 && UUID_PATTERN.test(parts[1])) {
    return participatedInRoom(userId, parts[1]);
  }

  return false;
}

function ownsPath(userId: string, path: string) {
  const parts = path.split("/");
  return (
    (parts[0] === "inquiries" && parts[1] === userId) ||
    (parts[0] === "direct-messages" && parts[2] === userId) ||
    (parts[0] === "rooms" && parts[2] === userId)
  );
}

async function isPersistedPath(path: string) {
  const admin = createAdminClient();
  if (path.startsWith("inquiries/")) {
    const { data } = await admin
      .from("support_inquiries")
      .select("id")
      .eq("image_path", path)
      .limit(1)
      .maybeSingle();
    return Boolean(data);
  }
  if (path.startsWith("direct-messages/")) {
    const { data } = await admin
      .from("direct_messages")
      .select("id")
      .eq("image_path", path)
      .limit(1)
      .maybeSingle();
    return Boolean(data);
  }
  return false;
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const limited = await enforceRateLimit(request, {
    scope: "private-image-upload",
    identifier: user.id,
    limit: 30,
    windowSeconds: 3600,
  });
  if (limited) return limited;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "잘못된 업로드 요청입니다." }, { status: 400 });
  }

  const file = form.get("file");
  const context = String(form.get("context") ?? "");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "이미지 파일을 선택해 주세요." }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "이미지는 5MB 이하만 업로드할 수 있습니다." }, { status: 413 });
  }

  const extension = MIME_EXTENSIONS.get(file.type);
  if (!extension) {
    return NextResponse.json(
      { error: "JPEG, PNG, WebP 이미지만 업로드할 수 있습니다." },
      { status: 415 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasValidSignature(bytes, file.type)) {
    return NextResponse.json({ error: "이미지 파일 형식이 올바르지 않습니다." }, { status: 415 });
  }

  let prefix: string;
  if (context === "inquiry") {
    prefix = `inquiries/${user.id}`;
  } else if (context === "direct-message") {
    const otherUserId = String(form.get("otherUserId") ?? "");
    if (!UUID_PATTERN.test(otherUserId) || !(await areFriends(user.id, otherUserId))) {
      return NextResponse.json({ error: "친구에게만 이미지를 보낼 수 있습니다." }, { status: 403 });
    }
    prefix = `direct-messages/${directMessagePair(user.id, otherUserId)}/${user.id}`;
  } else if (context === "room") {
    const roomId = String(form.get("roomId") ?? "");
    if (!UUID_PATTERN.test(roomId) || !(await participatedInRoom(user.id, roomId))) {
      return NextResponse.json({ error: "참여 중인 방에서만 이미지를 보낼 수 있습니다." }, { status: 403 });
    }
    prefix = `rooms/${roomId}/${user.id}`;
  } else {
    return NextResponse.json({ error: "이미지 사용 위치가 올바르지 않습니다." }, { status: 400 });
  }

  const path = `${prefix}/${crypto.randomUUID()}.${extension}`;
  const { error } = await createAdminClient().storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (error) {
    console.error("private_image_upload_failed", error);
    return NextResponse.json({ error: "이미지를 저장하지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({ path }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const path = request.nextUrl.searchParams.get("path") ?? "";
  if (!safeStoragePath(path) || !(await canReadPath(user.id, path))) {
    return new NextResponse(null, { status: 403 });
  }

  const { data, error } = await createAdminClient().storage.from(BUCKET).download(path);
  if (error || !data) return new NextResponse(null, { status: 404 });

  return new NextResponse(await data.arrayBuffer(), {
    headers: {
      "Content-Type": data.type || "application/octet-stream",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(request: NextRequest) {
  const user = await currentUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const path = request.nextUrl.searchParams.get("path") ?? "";
  if (!safeStoragePath(path) || !ownsPath(user.id, path)) {
    return new NextResponse(null, { status: 403 });
  }
  if (await isPersistedPath(path)) {
    return NextResponse.json(
      { error: "전송된 이미지는 삭제할 수 없습니다." },
      { status: 409 },
    );
  }

  const { error } = await createAdminClient().storage.from(BUCKET).remove([path]);
  if (error) return new NextResponse(null, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
