import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rate-limit";

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

type InviteStatus = "pending" | "accepted" | "declined" | "cancelled";

type InviteRow = {
  id: string;
  sender_id: string;
  receiver_id: string;
  match_request_id: string | null;
  draft_id: string | null;
  status: InviteStatus;
  created_at: string;
  required_stage: number | null;
  min_combat_power: number | null;
  dungeons?: { name: string } | { name: string }[] | null;
  profiles?: { nickname: string } | { nickname: string }[] | null;
  match_requests?: {
    status: string;
    required_stage: number;
    min_combat_power: number;
    dungeons?: { name: string } | { name: string }[] | null;
  } | {
    status: string;
    required_stage: number;
    min_combat_power: number;
    dungeons?: { name: string } | { name: string }[] | null;
  }[] | null;
};

export async function GET(request: NextRequest) {
  const admin = getAdmin();
  if (!admin) return jsonError("SUPABASE_SERVICE_ROLE_KEY is missing.", 500);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return jsonError("로그인이 필요합니다.", 401);

  const draftId = request.nextUrl.searchParams.get("draftId");
  if (draftId) {
    const { data, error } = await admin
      .from("matching_invites")
      .select("receiver_id, status")
      .eq("sender_id", user.id)
      .eq("draft_id", draftId);

    if (error) return jsonError(error.message, 500);

    return NextResponse.json({
      inviteStatuses: ((data ?? []) as { receiver_id: string; status: InviteStatus }[]).map(
        (row) => ({ userId: row.receiver_id, status: row.status }),
      ),
    });
  }

  const { data, error } = await admin
    .from("matching_invites")
    .select(
      "id, sender_id, receiver_id, match_request_id, draft_id, status, created_at, required_stage, min_combat_power, dungeons(name), profiles!matching_invites_sender_id_fkey(nickname), match_requests(status, required_stage, min_combat_power, dungeons(name))",
    )
    .eq("receiver_id", user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) return jsonError(error.message, 500);

  const invites = ((data ?? []) as unknown as InviteRow[]).flatMap((invite) => {
    const profile = Array.isArray(invite.profiles) ? invite.profiles[0] : invite.profiles;
    const matchRequest = Array.isArray(invite.match_requests)
      ? invite.match_requests[0]
      : invite.match_requests;
    const requestDungeon = Array.isArray(matchRequest?.dungeons)
      ? matchRequest?.dungeons[0]
      : matchRequest?.dungeons;
    const draftDungeon = Array.isArray(invite.dungeons) ? invite.dungeons[0] : invite.dungeons;

    if (
      invite.match_request_id &&
      (!matchRequest || !["waiting", "processing"].includes(matchRequest.status))
    ) {
      return [];
    }

    return [{
      inviteId: invite.id,
      senderId: invite.sender_id,
      matchRequestId: invite.match_request_id,
      draftId: invite.draft_id,
      nickname: profile?.nickname ?? "파티장",
      dungeonName: requestDungeon?.name ?? draftDungeon?.name ?? "파티",
      stage: matchRequest?.required_stage ?? invite.required_stage ?? 0,
      minCombatPower: matchRequest?.min_combat_power ?? invite.min_combat_power ?? 0,
      createdAt: invite.created_at,
    }];
  });

  return NextResponse.json({ invites });
}

export async function POST(request: NextRequest) {
  const admin = getAdmin();
  if (!admin) return jsonError("SUPABASE_SERVICE_ROLE_KEY is missing.", 500);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return jsonError("로그인이 필요합니다.", 401);

  let body: {
    draftId?: string;
    receiverId?: string;
    dungeonId?: string;
    stage?: number;
    minCombatPower?: number;
    maxMembers?: number;
    characterId?: string;
    requiredClasses?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return jsonError("잘못된 요청입니다.", 400);
  }

  const draftId = body.draftId?.trim();
  const receiverId = body.receiverId?.trim();
  const dungeonId = body.dungeonId?.trim();
  if (!draftId || !receiverId || !dungeonId) {
    return jsonError("초대 조건이 부족합니다.", 400);
  }

  const limited = await enforceRateLimit(request, {
    scope: "matching-invite",
    identifier: user.id,
    limit: 30,
    windowSeconds: 60,
  });
  if (limited) return limited;
  if (receiverId === user.id) return jsonError("자기 자신은 초대할 수 없습니다.", 400);

  const { data: friendship, error: friendshipError } = await admin
    .from("friend_requests")
    .select("sender_id, receiver_id")
    .eq("status", "accepted")
    .or(
      `and(sender_id.eq.${user.id},receiver_id.eq.${receiverId}),and(sender_id.eq.${receiverId},receiver_id.eq.${user.id})`,
    )
    .limit(1)
    .maybeSingle();

  if (friendshipError) return jsonError(friendshipError.message, 500);
  if (!friendship) return jsonError("친구만 초대할 수 있습니다.", 400);

  const { data: receiverProfile, error: profileError } = await admin
    .from("profiles")
    .select("nickname")
    .eq("id", receiverId)
    .maybeSingle();
  if (profileError) return jsonError(profileError.message, 500);

  const isDummy = ((receiverProfile as { nickname?: string } | null)?.nickname ?? "")
    .startsWith("더미");
  const now = new Date().toISOString();
  const requiredClasses = Array.isArray(body.requiredClasses)
    ? body.requiredClasses.filter((value) => typeof value === "string" && value.trim())
    : [];

  const { error } = await admin.from("matching_invites").upsert({
    sender_id: user.id,
    receiver_id: receiverId,
    draft_id: draftId,
    match_request_id: null,
    dungeon_id: dungeonId,
    required_stage: Math.max(0, Math.trunc(Number(body.stage) || 0)),
    min_combat_power: Math.max(0, Math.trunc(Number(body.minCombatPower) || 0)),
    max_members: Math.max(0, Math.trunc(Number(body.maxMembers) || 0)),
    character_row_id: body.characterId || null,
    required_classes: requiredClasses,
    status: isDummy ? "accepted" : "pending",
    responded_at: isDummy ? now : null,
  } as unknown as never, { onConflict: "sender_id,draft_id,receiver_id" });

  if (error) return jsonError(error.message, 500);

  return NextResponse.json({
    ok: true,
    inviteStatus: { userId: receiverId, status: isDummy ? "accepted" : "pending" },
  });
}

export async function PATCH(request: NextRequest) {
  const admin = getAdmin();
  if (!admin) return jsonError("SUPABASE_SERVICE_ROLE_KEY is missing.", 500);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return jsonError("로그인이 필요합니다.", 401);

  const limited = await enforceRateLimit(request, {
    scope: "matching-invite",
    identifier: user.id,
    limit: 30,
    windowSeconds: 60,
  });
  if (limited) return limited;

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
  const invite = inviteRow as { match_request_id: string | null; receiver_id: string } | null;
  if (!invite) return jsonError("이미 처리된 초대입니다.", 409);

  if (body.accept && invite.match_request_id) {
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

    await admin
      .from("match_requests")
      .update({
        invited_friend_ids: nextIds,
        heartbeat_at: new Date().toISOString(),
        status: "waiting",
      } as unknown as never)
      .eq("id", invite.match_request_id)
      .in("status", ["waiting", "processing"]);
  }

  if (body.accept) {
    await Promise.all([
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
