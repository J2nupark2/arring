import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type LeaveBody = { roomId?: string };
type AdminClient = ReturnType<typeof createAdminClient>;

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function createLeaveRefillRequest(
  admin: AdminClient,
  roomId: string,
  leavingUserId: string,
  nextHostId: string,
) {
  const [{ data: room }, { data: activeRefill }, { data: activeParticipants }] =
    await Promise.all([
      admin
        .from("rooms")
        .select("id, status, max_members")
        .eq("id", roomId)
        .maybeSingle(),
      admin
        .from("match_requests")
        .select("id")
        .eq("refill_room_id", roomId)
        .in("status", ["waiting", "processing"])
        .limit(1)
        .maybeSingle(),
      admin
        .from("room_participants")
        .select("user_id")
        .eq("room_id", roomId)
        .is("left_at", null),
    ]);

  if (!room || room.status !== "active" || activeRefill) return;
  if ((activeParticipants?.length ?? 0) >= room.max_members) return;

  const [{ data: sourceRequest }, { data: leavingQueue }, { data: nextHostCharacter }] =
    await Promise.all([
      admin
        .from("match_requests")
        .select(
          "id, dungeon_id, required_stage, min_combat_power, required_classes",
        )
        .eq("room_id", roomId)
        .in("status", ["matched", "cancelled"])
        .order("matched_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("match_queue")
        .select("character_row_id, requested_stage, match_request_id")
        .eq("room_id", roomId)
        .eq("user_id", leavingUserId)
        .eq("status", "matched")
        .order("matched_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("aion2_characters")
        .select("id")
        .eq("user_id", nextHostId)
        .order("is_primary", { ascending: false })
        .order("synced_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (!sourceRequest || !nextHostCharacter) return;

  const sourceMatchRequestId = leavingQueue?.match_request_id ?? sourceRequest.id;
  const { data: originalTemporaryMatch } = sourceMatchRequestId
    ? await admin
        .from("temporary_matches")
        .select("candidate_user_ids")
        .eq("match_request_id", sourceMatchRequestId)
        .eq("status", "confirmed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };
  const fixedSlotCount = (sourceRequest.required_classes ?? []).filter(Boolean).length;
  const leavingCandidateIndex = originalTemporaryMatch?.candidate_user_ids?.indexOf(
    leavingUserId,
  ) ?? -1;
  const leavingWasFixedClassSlot =
    leavingCandidateIndex >= 0 && leavingCandidateIndex < fixedSlotCount;
  const { data: leavingCharacter } =
    leavingWasFixedClassSlot && leavingQueue?.character_row_id
      ? await admin
          .from("aion2_characters")
          .select("class_name")
          .eq("id", leavingQueue.character_row_id)
          .maybeSingle()
      : { data: null };

  await admin.from("match_requests").insert({
    leader_id: nextHostId,
    dungeon_id: sourceRequest.dungeon_id,
    character_row_id: nextHostCharacter.id,
    required_stage: leavingQueue?.requested_stage ?? sourceRequest.required_stage,
    min_combat_power: sourceRequest.min_combat_power,
    required_classes: leavingCharacter?.class_name ? [leavingCharacter.class_name] : [],
    max_members: 2,
    invited_friend_ids: [],
    refill_room_id: roomId,
    excluded_user_ids: [
      ...new Set([
        ...(activeParticipants ?? []).map((participant) => participant.user_id),
        leavingUserId,
      ]),
    ],
    status: "waiting",
    heartbeat_at: new Date().toISOString(),
  } as never);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return error("로그인이 필요합니다.", 401);

  const body = (await request.json().catch(() => null)) as LeaveBody | null;
  const roomId = body?.roomId?.trim();
  if (!roomId) return error("방 정보가 필요합니다.", 400);

  const admin = createAdminClient();
  const leftAt = new Date().toISOString();
  const { data: roomBeforeLeave } = await admin
    .from("rooms")
    .select("id, host_id, created_by, status, max_members")
    .eq("id", roomId)
    .maybeSingle();

  const { error: participantError } = await admin
    .from("room_participants")
    .update({ left_at: leftAt })
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .is("left_at", null);
  if (participantError) return error("방에서 나가지 못했습니다.", 500);

  const { data: temporaryMatches } = await admin
    .from("temporary_matches")
    .select("id")
    .eq("room_id", roomId)
    .eq("status", "confirmed");
  const temporaryMatchIds = (temporaryMatches ?? []).map((match) => match.id);

  const updates = [
    admin
      .from("match_queue")
      .update({ status: "cancelled" } as never)
      .eq("room_id", roomId)
      .eq("user_id", user.id)
      .eq("status", "matched"),
    admin
      .from("match_requests")
      .update({ status: "cancelled" } as never)
      .eq("room_id", roomId)
      .eq("leader_id", user.id)
      .eq("status", "matched"),
  ];
  if (temporaryMatchIds.length > 0) {
    updates.push(
      admin
        .from("match_responses")
        .update({ status: "rejected", responded_at: leftAt } as never)
        .in("temporary_match_id", temporaryMatchIds)
        .eq("user_id", user.id),
    );
  }

  const results = await Promise.all(updates);
  if (results.some((result) => result.error)) {
    return error("매칭 퇴장 상태를 정리하지 못했습니다.", 500);
  }

  const { data: remainingParticipants } = await admin
    .from("room_participants")
    .select("user_id")
    .eq("room_id", roomId)
    .is("left_at", null)
    .order("joined_at", { ascending: true });
  const remainingUserIds = (remainingParticipants ?? []).map(
    (participant) => participant.user_id,
  );
  const currentHostId = roomBeforeLeave?.host_id ?? roomBeforeLeave?.created_by ?? null;
  const nextHostId =
    currentHostId === user.id ? (remainingUserIds[0] ?? null) : currentHostId;

  if (nextHostId && nextHostId !== currentHostId) {
    await admin.from("rooms").update({ host_id: nextHostId } as never).eq("id", roomId);
  }

  if (nextHostId && remainingUserIds.length > 0) {
    await createLeaveRefillRequest(admin, roomId, user.id, nextHostId);
  }

  await supabase.rpc("set_current_room", { p_room_code: null });
  return NextResponse.json({ left: true });
}
