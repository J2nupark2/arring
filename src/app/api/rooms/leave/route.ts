import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type LeaveBody = { roomId?: string };

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.is_anonymous) return error("로그인이 필요합니다.", 401);

  const body = (await request.json().catch(() => null)) as LeaveBody | null;
  const roomId = body?.roomId?.trim();
  if (!roomId) return error("방 정보가 필요합니다.", 400);

  const admin = createAdminClient();
  const leftAt = new Date().toISOString();
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
    admin.from("match_queue").update({ status: "cancelled" } as never)
      .eq("room_id", roomId).eq("user_id", user.id).eq("status", "matched"),
    admin.from("match_requests").update({ status: "cancelled" } as never)
      .eq("room_id", roomId).eq("leader_id", user.id).eq("status", "matched"),
  ];
  if (temporaryMatchIds.length > 0) {
    updates.push(
      admin.from("match_responses")
        .update({ status: "rejected", responded_at: leftAt } as never)
        .in("temporary_match_id", temporaryMatchIds)
        .eq("user_id", user.id),
    );
  }

  const results = await Promise.all(updates);
  if (results.some((result) => result.error)) {
    return error("매칭 퇴장 상태를 정리하지 못했습니다.", 500);
  }

  await supabase.rpc("set_current_room", { p_room_code: null });
  return NextResponse.json({ left: true });
}
