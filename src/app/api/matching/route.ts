import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { generateRoomCode } from "@/lib/room-code";

const ROOM_TTL_HOURS = 6;

type Profile = {
  id: string;
  nickname: string;
  server: string | null;
  manner_temperature: number | null;
  trust_temperature: number | null;
};

type CharacterRow = {
  id: string;
  user_id: string;
  class_name: string;
  combat_power: number;
};

type MatchRequest = {
  id: string;
  leader_id: string;
  dungeon_id: string;
  character_row_id: string | null;
  required_stage: number;
  min_combat_power: number;
  required_classes: string[];
  max_members: number;
};

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

type AdminClient = NonNullable<ReturnType<typeof getAdmin>>;

function score(profile: Profile) {
  return (profile.manner_temperature ?? 36.5) + (profile.trust_temperature ?? 36.5);
}

async function getUserCharacter(
  admin: AdminClient,
  userId: string,
  characterId?: string,
) {
  let query = admin
    .from("aion2_characters")
    .select("id, user_id, class_name, combat_power")
    .eq("user_id", userId);

  if (characterId) {
    query = query.eq("id", characterId);
  } else {
    query = query.order("is_primary", { ascending: false }).order("synced_at", {
      ascending: false,
    });
  }

  const { data, error } = await query.limit(1).single();
  if (error || !data) return null;
  return data as CharacterRow;
}

async function createRoom(
  admin: AdminClient,
  leader: Profile,
  request: MatchRequest,
  memberIds: string[],
) {
  const expiresAt = new Date(
    Date.now() + ROOM_TTL_HOURS * 60 * 60 * 1000,
  ).toISOString();

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const { data: dungeonData } = await admin
      .from("dungeons")
      .select("name")
      .eq("id", request.dungeon_id)
      .single();
    const dungeon = dungeonData as { name: string } | null;

    const { data: room, error } = await admin
      .from("rooms")
      .insert({
        code,
        title: `${dungeon?.name ?? "아이온2"} 자동매칭`,
        max_members: request.max_members,
        is_public: false,
        created_by: leader.id,
        host_id: leader.id,
        expires_at: expiresAt,
      } as unknown as never)
      .select("id, code")
      .single();

    if (error?.code === "23505") continue;
    const createdRoom = room as { id: string; code: string } | null;
    if (error || !createdRoom) throw new Error(error?.message ?? "방 생성 실패");

    const participants = [leader.id, ...memberIds].map((user_id) => ({
      room_id: createdRoom.id,
      user_id,
    }));
    const { error: participantError } = await admin
      .from("room_participants")
      .insert(participants as unknown as never);

    if (participantError) throw new Error(participantError.message);
    return createdRoom;
  }

  throw new Error("방 코드 생성 실패");
}

async function findCandidates(
  admin: AdminClient,
  request: MatchRequest,
) {
  const { data: queueRows, error: queueError } = await admin
    .from("match_queue")
    .select("id, user_id, character_row_id, requested_stage, created_at")
    .eq("status", "waiting")
    .eq("dungeon_id", request.dungeon_id)
    .gte("requested_stage", request.required_stage)
    .order("created_at", { ascending: true })
    .limit(50);

  if (queueError) throw new Error(queueError.message);
  const rows = (queueRows ?? []) as {
    id: string;
    user_id: string;
    character_row_id: string | null;
    requested_stage: number;
    created_at: string;
  }[];
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.user_id);
  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select(
      "id, nickname, server, manner_temperature, trust_temperature",
    )
    .in("id", ids);

  if (profileError) throw new Error(profileError.message);

  const characterIds = rows
    .map((row) => row.character_row_id)
    .filter((id): id is string => !!id);
  const { data: characters, error: characterError } =
    characterIds.length > 0
      ? await admin
          .from("aion2_characters")
          .select("id, user_id, class_name, combat_power")
          .in("id", characterIds)
      : { data: [], error: null };

  if (characterError) throw new Error(characterError.message);

  const profileList = (profiles ?? []) as Profile[];
  const profileById = new Map(profileList.map((p) => [p.id, p]));
  const characterById = new Map(
    ((characters ?? []) as CharacterRow[]).map((character) => [character.id, character]),
  );
  const requiredClasses = request.required_classes ?? [];

  return rows
    .map((row) => ({
      row,
      profile: profileById.get(row.user_id),
      character: row.character_row_id ? characterById.get(row.character_row_id) : undefined,
    }))
    .filter(({ profile, character }) => {
      if (!profile || !character) return false;
      if (character.combat_power < request.min_combat_power) return false;
      if (requiredClasses.length > 0 && !requiredClasses.includes(character.class_name)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => score(b.profile!) - score(a.profile!))
    .slice(0, Math.max(0, request.max_members - 1));
}

async function tryCompleteMatch(
  admin: AdminClient,
  request: MatchRequest,
) {
  const { data: leaderProfile, error: leaderError } = await admin
    .from("profiles")
    .select(
      "id, nickname, server, manner_temperature, trust_temperature",
    )
    .eq("id", request.leader_id)
    .single();

  if (leaderError || !leaderProfile) {
    throw new Error(leaderError?.message ?? "파티장 정보를 찾을 수 없습니다.");
  }

  const candidates = await findCandidates(admin, request);
  const needed = request.max_members - 1;
  if (candidates.length < needed) {
    return { matched: false, waitingCount: candidates.length, needed };
  }

  const chosen = candidates.slice(0, needed);
  const room = await createRoom(
    admin,
    leaderProfile as Profile,
    request,
    chosen.map(({ row }) => row.user_id),
  );

  await admin
    .from("match_requests")
    .update({
      status: "matched",
      room_id: room.id,
      matched_at: new Date().toISOString(),
    } as unknown as never)
    .eq("id", request.id);

  await admin
    .from("match_queue")
    .update({
      status: "matched",
      match_request_id: request.id,
      room_id: room.id,
      matched_at: new Date().toISOString(),
    } as unknown as never)
    .in(
      "id",
      chosen.map(({ row }) => row.id),
    );

  return { matched: true, roomCode: room.code };
}

export async function POST(request: NextRequest) {
  const admin = getAdmin();
  if (!admin) {
    return jsonError("서버에 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.", 500);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return jsonError("로그인이 필요합니다.", 401);
  if (user.is_anonymous) {
    return jsonError("자동매칭은 회원가입 후 이용할 수 있습니다.", 403);
  }

  let body: {
    role?: "leader" | "member";
    dungeonId?: string;
    stage?: number;
    minCombatPower?: number;
    requiredClasses?: string[];
    maxMembers?: number;
    characterId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return jsonError("잘못된 요청입니다.", 400);
  }

  const dungeonId = body.dungeonId?.trim();
  const stage = Math.max(0, Math.trunc(Number(body.stage) || 0));
  if (!dungeonId || !body.role) return jsonError("매칭 조건을 확인해주세요.", 400);

  const selectedCharacter = await getUserCharacter(admin, user.id, body.characterId);

  if (!selectedCharacter) {
    return jsonError("프로필에서 아이온2 캐릭터를 먼저 연동해주세요.", 400);
  }

  await admin.from("dungeon_progress").upsert({
    user_id: user.id,
    dungeon_id: dungeonId,
    stage,
    updated_at: new Date().toISOString(),
  } as unknown as never);

  if (body.role === "leader") {
    const maxMembers = Math.min(Math.max(Math.trunc(Number(body.maxMembers) || 6), 2), 12);
    const minCombatPower = Math.max(0, Math.trunc(Number(body.minCombatPower) || 0));
    const requiredClasses = Array.isArray(body.requiredClasses)
      ? body.requiredClasses.filter((value) => typeof value === "string" && value.trim())
      : [];

    const { data: matchRequest, error } = await admin
      .from("match_requests")
      .insert({
        leader_id: user.id,
        dungeon_id: dungeonId,
        character_row_id: selectedCharacter.id,
        required_stage: stage,
        min_combat_power: minCombatPower,
        required_classes: requiredClasses,
        max_members: maxMembers,
      } as unknown as never)
      .select(
        "id, leader_id, dungeon_id, character_row_id, required_stage, min_combat_power, required_classes, max_members",
      )
      .single();

    if (error || !matchRequest) {
      return jsonError("매칭 요청 생성에 실패했습니다: " + (error?.message ?? ""), 500);
    }

    const result = await tryCompleteMatch(admin, matchRequest as MatchRequest);
    return NextResponse.json(result);
  }

  const { error: queueError } = await admin.from("match_queue").upsert(
    {
      user_id: user.id,
      dungeon_id: dungeonId,
      character_row_id: selectedCharacter.id,
      requested_stage: stage,
      status: "waiting",
      created_at: new Date().toISOString(),
    } as unknown as never,
    { onConflict: "user_id,dungeon_id,status" },
  );

  if (queueError) {
    return jsonError("대기열 등록에 실패했습니다: " + queueError.message, 500);
  }

  const { data: requests, error: requestError } = await admin
    .from("match_requests")
    .select(
      "id, leader_id, dungeon_id, character_row_id, required_stage, min_combat_power, required_classes, max_members",
    )
    .eq("status", "waiting")
    .eq("dungeon_id", dungeonId)
    .lte("required_stage", stage)
    .lte("min_combat_power", selectedCharacter.combat_power)
    .order("created_at", { ascending: true })
    .limit(10);

  if (requestError) {
    return jsonError("매칭 탐색에 실패했습니다: " + requestError.message, 500);
  }

  const compatible = ((requests ?? []) as MatchRequest[]).filter((matchRequest) => {
    const classes = matchRequest.required_classes ?? [];
    return classes.length === 0 || classes.includes(selectedCharacter.class_name);
  });

  for (const matchRequest of compatible) {
    const result = await tryCompleteMatch(admin, matchRequest);
    if (result.matched) return NextResponse.json(result);
  }

  return NextResponse.json({ matched: false });
}
