import { NextRequest, NextResponse } from "next/server";

import { enforceRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const CATEGORIES = new Set([
  "general",
  "bug",
  "account",
  "privacy",
  "partnership",
]);
const STATUSES = new Set(["open", "answered", "closed"]);
const INQUIRY_FIELDS =
  "id, user_id, contact_email, category, subject, message, image_path, status, admin_reply, answered_at, created_at, updated_at";

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user && !user.is_anonymous ? user : null;
}

async function isAdmin(userId: string) {
  const { data } = await createAdminClient()
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  return data?.is_admin === true;
}

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const admin = createAdminClient();
  const adminAccess = await isAdmin(user.id);
  let query = admin
    .from("support_inquiries")
    .select(INQUIRY_FIELDS)
    .order("created_at", { ascending: false })
    .limit(adminAccess ? 200 : 50);
  if (!adminAccess) query = query.eq("user_id", user.id);

  const { data, error } = await query;
  if (error) {
    console.error("support_inquiry_list_failed", error);
    return NextResponse.json(
      { error: "문의 목록을 불러오지 못했습니다." },
      { status: 500 },
    );
  }

  return NextResponse.json({ inquiries: data ?? [], isAdmin: adminAccess });
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user?.email) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const limited = await enforceRateLimit(request, {
    scope: "support-inquiry-create",
    identifier: user.id,
    limit: 5,
    windowSeconds: 3600,
  });
  if (limited) return limited;

  let body: {
    category?: string;
    subject?: string;
    message?: string;
    imagePath?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const category = body.category?.trim() ?? "";
  const subject = body.subject?.trim() ?? "";
  const message = body.message?.trim() ?? "";
  const imagePath = body.imagePath?.trim() || null;
  if (!CATEGORIES.has(category)) {
    return NextResponse.json({ error: "문의 유형을 선택해 주세요." }, { status: 400 });
  }
  if (subject.length < 2 || subject.length > 120) {
    return NextResponse.json(
      { error: "제목은 2자 이상 120자 이하로 입력해 주세요." },
      { status: 400 },
    );
  }
  if (message.length < 10 || message.length > 5000) {
    return NextResponse.json(
      { error: "문의 내용은 10자 이상 5,000자 이하로 입력해 주세요." },
      { status: 400 },
    );
  }
  if (imagePath && !imagePath.startsWith(`inquiries/${user.id}/`)) {
    return NextResponse.json({ error: "첨부 이미지 정보가 올바르지 않습니다." }, { status: 400 });
  }

  const { data, error } = await createAdminClient()
    .from("support_inquiries")
    .insert({
      user_id: user.id,
      contact_email: user.email,
      category,
      subject,
      message,
      image_path: imagePath,
    })
    .select(INQUIRY_FIELDS)
    .single();
  if (error) {
    console.error("support_inquiry_create_failed", error);
    return NextResponse.json({ error: "문의를 등록하지 못했습니다." }, { status: 500 });
  }

  return NextResponse.json({ inquiry: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (!(await isAdmin(user.id))) {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const limited = await enforceRateLimit(request, {
    scope: "support-inquiry-answer",
    identifier: user.id,
    limit: 60,
    windowSeconds: 3600,
  });
  if (limited) return limited;

  let body: { id?: string; reply?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const id = body.id?.trim() ?? "";
  const reply = body.reply?.trim() ?? "";
  const status = body.status?.trim() ?? "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    ) ||
    !STATUSES.has(status)
  ) {
    return NextResponse.json({ error: "잘못된 문의 정보입니다." }, { status: 400 });
  }
  if (status === "answered" && (reply.length < 2 || reply.length > 5000)) {
    return NextResponse.json(
      { error: "답변은 2자 이상 5,000자 이하로 입력해 주세요." },
      { status: 400 },
    );
  }
  if (reply.length > 5000) {
    return NextResponse.json({ error: "답변은 5,000자 이하로 입력해 주세요." }, { status: 400 });
  }

  const update =
    status === "answered"
      ? {
          status,
          admin_reply: reply,
          answered_by: user.id,
          answered_at: new Date().toISOString(),
        }
      : { status };
  const { data, error } = await createAdminClient()
    .from("support_inquiries")
    .update(update)
    .eq("id", id)
    .select(INQUIRY_FIELDS)
    .maybeSingle();
  if (error) {
    console.error("support_inquiry_answer_failed", error);
    return NextResponse.json({ error: "문의 상태를 변경하지 못했습니다." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "문의를 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ inquiry: data });
}
