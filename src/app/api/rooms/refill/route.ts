import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/rate-limit";

type RefillBody = {
  roomId?: string;
  targetUserId?: string;
};

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return error("로그인이 필요합니다.", 401);
  const roomId = request.nextUrl.searchParams.get("roomId")?.trim();
  if (!roomId) return error("방 정보가 필요합니다.", 400);

  const admin = createAdminClient();
  const { data: room } = await admin
    .from("rooms")
    .select("host_id, created_by")
    .eq("id", roomId)
    .maybeSingle();
  if (!room || (room.host_id ?? room.created_by) !== user.id) {
    return error("방장만 재매칭 상태를 확인할 수 있습니다.", 403);
  }
  const { data: refill } = await admin
    .from("match_requests")
    .select("id, status, created_at")
    .eq("refill_room_id", roomId)
    .in("status", ["waiting", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ active: !!refill, refillRequest: refill ?? null });
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, {
    scope: "room-refill",
    limit: 10,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return error("로그인이 필요합니다.", 401);

  const body = (await request.json().catch(() => null)) as RefillBody | null;
  const roomId = body?.roomId?.trim();
  const targetUserId = body?.targetUserId?.trim();
  if (!roomId || !targetUserId || targetUserId === user.id) {
    return error("추방할 파티원을 확인해 주세요.", 400);
  }

  const admin = createAdminClient();
  const { data: room, error: roomError } = await admin
    .from("rooms")
    .select("id, code, host_id, created_by, status, max_members")
    .eq("id", roomId)
    .maybeSingle();
  if (roomError) return error("방 정보를 불러오지 못했습니다.", 500);
  if (!room || room.status !== "active") return error("활성화된 방이 아닙니다.", 404);
  if ((room.host_id ?? room.created_by) !== user.id) {
    return error("방장만 파티원을 추방하고 재매칭할 수 있습니다.", 403);
  }

  const { data: targetParticipant } = await admin
    .from("room_participants")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_id", targetUserId)
    .is("left_at", null)
    .limit(1)
    .maybeSingle();
  if (!targetParticipant) return error("현재 방에 없는 파티원입니다.", 409);

  const { data: activeRefill } = await admin
    .from("match_requests")
    .select("id")
    .eq("refill_room_id", roomId)
    .in("status", ["waiting", "processing"])
    .limit(1)
    .maybeSingle();
  if (activeRefill) return error("이미 빈자리를 재매칭하고 있습니다.", 409);

  const [{ data: activeParticipants }, { data: targetQueue }, { data: sourceRequest }] =
    await Promise.all([
      admin
        .from("room_participants")
        .select("user_id")
        .eq("room_id", roomId)
        .is("left_at", null),
      admin
        .from("match_queue")
        .select("character_row_id, requested_stage, match_request_id, dungeon_id")
        .eq("room_id", roomId)
        .eq("user_id", targetUserId)
        .eq("status", "matched")
        .order("matched_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("match_requests")
        .select(
          "id, dungeon_id, character_row_id, required_stage, min_combat_power, required_classes",
        )
        .eq("room_id", roomId)
        .eq("leader_id", user.id)
        .eq("status", "matched")
        .order("matched_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (!sourceRequest) {
    return error("기존 매칭 조건을 찾지 못해 재매칭을 시작할 수 없습니다.", 409);
  }

  const { data: targetCharacter } = targetQueue?.character_row_id
    ? await admin
        .from("aion2_characters")
        .select("class_name")
        .eq("id", targetQueue.character_row_id)
        .maybeSingle()
    : await admin
        .from("aion2_characters")
        .select("class_name")
        .eq("user_id", targetUserId)
        .order("is_primary", { ascending: false })
        .order("synced_at", { ascending: false })
        .limit(1)
        .maybeSingle();
  const replacementClasses = targetCharacter?.class_name
    ? [targetCharacter.class_name]
    : sourceRequest.required_classes;
  const excludedUserIds = [
    ...new Set([
      ...(activeParticipants ?? []).map((participant) => participant.user_id),
      targetUserId,
    ]),
  ];
  const sourceMatchRequestId = targetQueue?.match_request_id ?? sourceRequest.id;
  const { data: originalTemporaryMatch } = sourceMatchRequestId
    ? await admin
        .from("temporary_matches")
        .select("id")
        .eq("match_request_id", sourceMatchRequestId)
        .eq("status", "confirmed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const { data: refillRequest, error: refillError } = await admin
    .from("match_requests")
    .insert({
      leader_id: user.id,
      dungeon_id: sourceRequest.dungeon_id,
      character_row_id: sourceRequest.character_row_id,
      required_stage: targetQueue?.requested_stage ?? sourceRequest.required_stage,
      min_combat_power: sourceRequest.min_combat_power,
      required_classes: replacementClasses,
      max_members: 2,
      invited_friend_ids: [],
      refill_room_id: roomId,
      excluded_user_ids: excludedUserIds,
      status: "waiting",
    })
    .select("id")
    .single();
  if (refillError || !refillRequest) {
    return error(refillError?.message ?? "재매칭 요청을 만들지 못했습니다.", 409);
  }

  const now = new Date().toISOString();
  const [kickResult, participantResult, queueResult, profileResult, responseResult] = await Promise.all([
    admin.from("room_kicks").upsert({
      room_id: roomId,
      target_id: targetUserId,
      kicked_by: user.id,
      created_at: now,
    }),
    admin
      .from("room_participants")
      .update({ left_at: now })
      .eq("room_id", roomId)
      .eq("user_id", targetUserId)
      .is("left_at", null),
    admin
      .from("match_queue")
      .update({ status: "cancelled", room_id: null })
      .eq("room_id", roomId)
      .eq("user_id", targetUserId)
      .eq("status", "matched"),
    admin.from("profiles").update({ current_room_code: null }).eq("id", targetUserId),
    originalTemporaryMatch
      ? admin
          .from("match_responses")
          .update({ status: "rejected", responded_at: now })
          .eq("temporary_match_id", originalTemporaryMatch.id)
          .eq("user_id", targetUserId)
      : Promise.resolve({ error: null }),
  ]);

  if (
    kickResult.error ||
    participantResult.error ||
    queueResult.error ||
    profileResult.error ||
    responseResult.error
  ) {
    await admin.from("match_requests").update({ status: "cancelled" }).eq("id", refillRequest.id);
    await admin.from("room_kicks").delete().eq("room_id", roomId).eq("target_id", targetUserId);
    return error("추방 상태를 저장하지 못했습니다.", 500);
  }

  return NextResponse.json({
    ok: true,
    roomCode: room.code,
    refillRequestId: refillRequest.id,
    state: "waiting",
  });
}
