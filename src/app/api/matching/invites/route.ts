import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function getAdmin() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false },
  });
}

export async function GET() {
  const admin = getAdmin();
  if (!admin) return jsonError("SUPABASE_SERVICE_ROLE_KEY is missing.", 500);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return jsonError("로그인이 필요합니다.", 401);

  const { data, error } = await admin
    .from("matching_invites")
    .select(
      "id, sender_id, match_request_id, created_at, match_requests(status, dungeon_id, required_stage, min_combat_power, dungeons(name)), profiles!matching_invites_sender_id_fkey(nickname)",
    )
    .eq("receiver_id", user.id)
    .eq("status", "pending")
    .in("match_requests.status", ["waiting", "processing"])
    .order("created_at", { ascending: false });

  if (error) return jsonError(error.message, 500);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    sender_id: string;
    match_request_id: string;
    created_at: string;
    profiles?: { nickname: string } | { nickname: string }[] | null;
    match_requests?: {
      dungeon_id: string;
      status: string;
      required_stage: number;
      min_combat_power: number;
      dungeons?: { name: string } | { name: string }[] | null;
    } | {
      dungeon_id: string;
      status: string;
      required_stage: number;
      min_combat_power: number;
      dungeons?: { name: string } | { name: string }[] | null;
    }[] | null;
  }>;

  const invites = rows.flatMap((invite) => {
    const profile = Array.isArray(invite.profiles)
      ? invite.profiles[0]
      : invite.profiles;
    const matchRequest = Array.isArray(invite.match_requests)
      ? invite.match_requests[0]
      : invite.match_requests;
    const dungeon = Array.isArray(matchRequest?.dungeons)
      ? matchRequest?.dungeons[0]
      : matchRequest?.dungeons;

    if (!matchRequest || !["waiting", "processing"].includes(matchRequest.status)) {
      return [];
    }

    return [{
    inviteId: invite.id,
    senderId: invite.sender_id,
    matchRequestId: invite.match_request_id,
    nickname: profile?.nickname ?? "파티장",
    dungeonName: dungeon?.name ?? "파티",
    stage: matchRequest?.required_stage ?? 0,
    minCombatPower: matchRequest?.min_combat_power ?? 0,
    createdAt: invite.created_at,
    }];
  });

  return NextResponse.json({ invites });
}

export async function PATCH(request: NextRequest) {
  const admin = getAdmin();
  if (!admin) return jsonError("SUPABASE_SERVICE_ROLE_KEY is missing.", 500);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return jsonError("로그인이 필요합니다.", 401);

  let body: { inviteId?: string; accept?: boolean };
  try {
    body = await request.json();
  } catch {
    return jsonError("잘못된 요청입니다.", 400);
  }

  if (!body.inviteId) return jsonError("초대 정보가 없습니다.", 400);

  const nextStatus = body.accept ? "accepted" : "declined";
  const { data: inviteRow, error: inviteError } = await admin
    .from("matching_invites")
    .update({
      status: nextStatus,
      responded_at: new Date().toISOString(),
    } as unknown as never)
    .eq("id", body.inviteId)
    .eq("receiver_id", user.id)
    .eq("status", "pending")
    .select("match_request_id, receiver_id")
    .maybeSingle();

  if (inviteError) return jsonError(inviteError.message, 500);
  const invite = inviteRow as { match_request_id: string; receiver_id: string } | null;
  if (!invite) return jsonError("이미 처리된 초대입니다.", 409);

  if (body.accept) {
    const { data: requestRow, error: requestError } = await admin
      .from("match_requests")
      .select("invited_friend_ids")
      .eq("id", invite.match_request_id)
      .in("status", ["waiting", "processing"])
      .maybeSingle();

    if (requestError) return jsonError(requestError.message, 500);
    const currentIds = (requestRow as { invited_friend_ids: string[] | null } | null)
      ?.invited_friend_ids ?? [];
    const nextIds = [...new Set([...currentIds, invite.receiver_id])];

    await Promise.all([
      admin
        .from("match_requests")
        .update({
          invited_friend_ids: nextIds,
          heartbeat_at: new Date().toISOString(),
          status: "waiting",
        } as unknown as never)
        .eq("id", invite.match_request_id)
        .in("status", ["waiting", "processing"]),
      admin
        .from("match_queue")
        .update({ status: "cancelled" } as unknown as never)
        .eq("user_id", invite.receiver_id)
        .in("status", ["waiting", "processing"]),
      admin
        .from("match_requests")
        .update({ status: "cancelled" } as unknown as never)
        .eq("leader_id", invite.receiver_id)
        .in("status", ["waiting", "processing"]),
    ]);
  }

  return NextResponse.json({ ok: true, accepted: body.accept === true });
}
