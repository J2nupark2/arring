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
  invited_friend_ids?: string[];
  created_at?: string;
};

type ExistingMatch = {
  matched: boolean;
  roomCode?: string;
};

type MatchState = "idle" | "waiting" | "processing" | "matched" | "cancelled";

type Candidate = {
  row: {
    id: string;
    user_id: string;
    character_row_id: string | null;
    requested_stage: number;
    created_at: string;
  };
  profile: Profile | undefined;
  character: CharacterRow | undefined;
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

function partySizeForCategory(category: string | null | undefined) {
  return category === "성역" ? 10 : 5;
}

async function getRoomCode(admin: AdminClient, roomId: string | null | undefined) {
  if (!roomId) return undefined;
  const { data } = await admin
    .from("rooms")
    .select("code, status, expires_at")
    .eq("id", roomId)
    .maybeSingle();
  const room = data as { code: string; status: string; expires_at: string } | null;
  if (!room || room.status !== "active") return undefined;
  if (new Date(room.expires_at).getTime() < Date.now()) return undefined;
  return room.code;
}

async function findExistingMatch(
  admin: AdminClient,
  userId: string,
  matchedAfter?: string | null,
): Promise<ExistingMatch> {
  const after = matchedAfter ?? new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: queueRow } = await admin
    .from("match_queue")
    .select("room_id")
    .eq("user_id", userId)
    .eq("status", "matched")
    .gte("matched_at", after)
    .order("matched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const queueRoomCode = await getRoomCode(
    admin,
    (queueRow as { room_id: string | null } | null)?.room_id,
  );
  if (queueRoomCode) return { matched: true, roomCode: queueRoomCode };

  const { data: requestRow } = await admin
    .from("match_requests")
    .select("room_id")
    .eq("leader_id", userId)
    .eq("status", "matched")
    .gte("matched_at", after)
    .order("matched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const requestRoomCode = await getRoomCode(
    admin,
    (requestRow as { room_id: string | null } | null)?.room_id,
  );
  if (requestRoomCode) return { matched: true, roomCode: requestRoomCode };

  return { matched: false };
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

    const invitedFriendIds = request.invited_friend_ids ?? [];
    if (invitedFriendIds.length > 0) {
      const { error: inviteError } = await admin.from("room_invites").insert(
        invitedFriendIds.map((receiver_id) => ({
          sender_id: leader.id,
          receiver_id,
          room_code: createdRoom.code,
        })) as unknown as never,
      );
      if (inviteError) throw new Error(inviteError.message);
    }

    return createdRoom;
  }

  throw new Error("방 코드 생성 실패");
}

async function findCandidates(
  admin: AdminClient,
  request: MatchRequest,
) {
  const invitedFriendIds = new Set(request.invited_friend_ids ?? []);
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
  return rows
    .map((row) => ({
      row,
      profile: profileById.get(row.user_id),
      character: row.character_row_id ? characterById.get(row.character_row_id) : undefined,
    }))
    .filter(({ row, profile, character }) => {
      if (!profile || !character) return false;
      if (row.user_id === request.leader_id) return false;
      if (invitedFriendIds.has(row.user_id)) return false;
      if (character.combat_power < request.min_combat_power) return false;
      return true;
    })
    .sort((a, b) => score(b.profile!) - score(a.profile!))
}

function selectCandidatesForSlots(
  candidates: Candidate[],
  requiredClasses: string[],
  needed: number,
) {
  if (needed <= 0) return [];

  const selected: Candidate[] = [];
  const usedQueueIds = new Set<string>();
  const fixedSlots = requiredClasses
    .filter((className) => className.trim())
    .slice(0, needed);

  const fixedSlotsByScarcity = [...fixedSlots].sort((a, b) => {
    const aCount = candidates.filter(
      (candidate) => candidate.character?.class_name === a,
    ).length;
    const bCount = candidates.filter(
      (candidate) => candidate.character?.class_name === b,
    ).length;
    return aCount - bCount;
  });

  for (const className of fixedSlotsByScarcity) {
    const candidate = candidates.find(
      (item) =>
        !usedQueueIds.has(item.row.id) &&
        item.character?.class_name === className,
    );

    if (!candidate) return null;
    selected.push(candidate);
    usedQueueIds.add(candidate.row.id);
  }

  for (const candidate of candidates) {
    if (selected.length >= needed) break;
    if (usedQueueIds.has(candidate.row.id)) continue;
    selected.push(candidate);
    usedQueueIds.add(candidate.row.id);
  }

  return selected.length >= needed ? selected : null;
}

async function tryCompleteMatch(
  admin: AdminClient,
  request: MatchRequest,
) {
  const { data: claimedRequest, error: claimError } = await admin
    .from("match_requests")
    .update({ status: "processing" } as unknown as never)
    .eq("id", request.id)
    .eq("status", "waiting")
    .select(
      "id, leader_id, dungeon_id, character_row_id, required_stage, min_combat_power, required_classes, max_members, invited_friend_ids, created_at",
    )
    .maybeSingle();

  if (claimError) throw new Error(claimError.message);

  if (!claimedRequest) {
    const { data: existingRequest } = await admin
      .from("match_requests")
      .select("room_id, status")
      .eq("id", request.id)
      .maybeSingle();
    const existing = existingRequest as {
      room_id: string | null;
      status: string;
    } | null;
    const roomCode = await getRoomCode(admin, existing?.room_id);
    if (roomCode) return { matched: true, roomCode };
    return {
      matched: false,
      active: false,
      state: "idle" satisfies MatchState,
      waitingCount: 0,
      needed: request.max_members - 1,
    };
  }

  const activeRequest = claimedRequest as MatchRequest;
  const { data: leaderProfile, error: leaderError } = await admin
    .from("profiles")
    .select(
      "id, nickname, server, manner_temperature, trust_temperature",
    )
    .eq("id", activeRequest.leader_id)
    .single();

  if (leaderError || !leaderProfile) {
    throw new Error(leaderError?.message ?? "파티장 정보를 찾을 수 없습니다.");
  }

  const candidates = await findCandidates(admin, activeRequest);
  const needed = Math.max(
    0,
    activeRequest.max_members - 1 - (activeRequest.invited_friend_ids?.length ?? 0),
  );
  const chosen = selectCandidatesForSlots(
    candidates,
    activeRequest.required_classes ?? [],
    needed,
  );

  if (!chosen) {
    await admin
      .from("match_requests")
      .update({ status: "waiting" } as unknown as never)
      .eq("id", activeRequest.id)
      .eq("status", "processing");
    return {
      matched: false,
      active: true,
      state: "waiting" satisfies MatchState,
      role: "leader",
      waitingCount: candidates.length,
      needed,
      since: activeRequest.created_at,
    };
  }

  const chosenQueueIds = chosen.map(({ row }) => row.id);
  if (chosenQueueIds.length > 0) {
    const { data: claimedQueues, error: claimQueueError } = await admin
      .from("match_queue")
      .update({
        status: "processing",
        match_request_id: activeRequest.id,
      } as unknown as never)
      .select("id")
      .in("id", chosenQueueIds)
      .eq("status", "waiting");

    if (claimQueueError) throw new Error(claimQueueError.message);

    if ((claimedQueues ?? []).length !== chosenQueueIds.length) {
      await admin
        .from("match_requests")
        .update({ status: "waiting" } as unknown as never)
        .eq("id", activeRequest.id)
        .eq("status", "processing");
      return {
        matched: false,
        active: true,
        state: "waiting" satisfies MatchState,
        role: "leader",
        waitingCount: Math.max(0, candidates.length - 1),
        needed,
        since: activeRequest.created_at,
      };
    }
  }

  let room: { id: string; code: string };
  try {
    room = await createRoom(
      admin,
      leaderProfile as Profile,
      activeRequest,
      chosen.map(({ row }) => row.user_id),
    );
  } catch (error) {
    await Promise.all([
      admin
        .from("match_requests")
        .update({ status: "waiting" } as unknown as never)
        .eq("id", activeRequest.id)
        .eq("status", "processing"),
      chosenQueueIds.length > 0
        ? admin
            .from("match_queue")
            .update({
              status: "waiting",
              match_request_id: null,
            } as unknown as never)
            .in("id", chosenQueueIds)
            .eq("status", "processing")
        : Promise.resolve({ error: null }),
    ]);
    throw error;
  }

  await admin
    .from("match_requests")
    .update({
      status: "matched",
      room_id: room.id,
      matched_at: new Date().toISOString(),
    } as unknown as never)
    .eq("id", activeRequest.id)
    .eq("status", "processing");

  if (chosenQueueIds.length > 0) {
    await admin
      .from("match_queue")
      .update({
        status: "matched",
        match_request_id: activeRequest.id,
        room_id: room.id,
        matched_at: new Date().toISOString(),
      } as unknown as never)
      .in(
      "id",
      chosenQueueIds,
    )
      .eq("status", "processing");
  }

  return { matched: true, roomCode: room.code };
}

async function getMatchStatus(
  admin: AdminClient,
  userId: string,
  matchedAfter?: string | null,
) {
  const existing = await findExistingMatch(admin, userId, matchedAfter);
  if (existing.matched) return { ...existing, state: "matched" satisfies MatchState, active: false };

  const requestQuery = admin
    .from("match_requests")
    .select("id, leader_id, dungeon_id, character_row_id, required_stage, min_combat_power, required_classes, max_members, invited_friend_ids, created_at, status")
    .eq("leader_id", userId)
    .in("status", ["waiting", "processing", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(1);

  const { data: request } = await requestQuery
    .maybeSingle();

  if (request) {
    const activeRequest = request as {
      id: string;
      leader_id: string;
      dungeon_id: string;
      character_row_id: string | null;
      required_stage: number;
      min_combat_power: number;
      required_classes: string[];
      max_members: number;
      invited_friend_ids?: string[];
      created_at: string;
      status: MatchState;
    };

    if (activeRequest.status === "cancelled") {
      return {
        matched: false,
        active: false,
        state: "cancelled" satisfies MatchState,
        role: "leader",
        since: activeRequest.created_at,
      };
    }

    if (activeRequest.status === "waiting" || activeRequest.status === "processing") {
      const candidates = await findCandidates(admin, activeRequest);

      return {
        matched: false,
        active: true,
        state: activeRequest.status,
        role: "leader",
        waitingCount: candidates.length,
        needed: Math.max(0, activeRequest.max_members - 1),
        since: activeRequest.created_at,
        status: activeRequest.status,
      };
    }
  }

  const queueQuery = admin
    .from("match_queue")
    .select("created_at, status")
    .eq("user_id", userId)
    .in("status", ["waiting", "processing", "cancelled"])
    .order("created_at", { ascending: false })
    .limit(1);

  const { data: queue } = await queueQuery
    .maybeSingle();

  if (queue) {
    const activeQueue = queue as { created_at: string; status: MatchState };
    if (activeQueue.status === "cancelled") {
      return {
        matched: false,
        active: false,
        state: "cancelled" satisfies MatchState,
        role: "member",
        since: activeQueue.created_at,
      };
    }
    return {
      matched: false,
      active: true,
      state: activeQueue.status,
      role: "member",
      since: activeQueue.created_at,
      status: activeQueue.status,
    };
  }

  return { matched: false, active: false, state: "idle" satisfies MatchState };
}

export async function GET(request: NextRequest) {
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
    return NextResponse.json({
      matched: false,
      active: false,
      state: "idle" satisfies MatchState,
    });
  }

  const matchedAfter = request.nextUrl.searchParams.get("since");
  return NextResponse.json(await getMatchStatus(admin, user.id, matchedAfter));
}

export async function DELETE() {
  const admin = getAdmin();
  if (!admin) {
    return jsonError("서버에 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.", 500);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return jsonError("로그인이 필요합니다.", 401);

  const [queueCancel, requestCancel] = await Promise.all([
    admin
      .from("match_queue")
      .update({ status: "cancelled" } as unknown as never)
      .eq("user_id", user.id)
      .in("status", ["waiting", "processing"]),
    admin
      .from("match_requests")
      .update({ status: "cancelled" } as unknown as never)
      .eq("leader_id", user.id)
      .in("status", ["waiting", "processing"]),
  ]);

  if (queueCancel.error || requestCancel.error) {
    return jsonError(
      "매칭 취소에 실패했습니다: " +
        (queueCancel.error?.message ?? requestCancel.error?.message ?? ""),
      500,
    );
  }

  return NextResponse.json({
    ok: true,
    matched: false,
    active: false,
    state: "cancelled" satisfies MatchState,
  });
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
    invitedFriendIds?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return jsonError("잘못된 요청입니다.", 400);
  }

  const dungeonId = body.dungeonId?.trim();
  const stage = Math.max(0, Math.trunc(Number(body.stage) || 0));
  if (!dungeonId || !body.role) return jsonError("매칭 조건을 확인해주세요.", 400);

  const { data: dungeon, error: dungeonError } = await admin
    .from("dungeons")
    .select("category")
    .eq("id", dungeonId)
    .single();

  if (dungeonError || !dungeon) {
    return jsonError("콘텐츠 정보를 찾을 수 없습니다.", 400);
  }

  const maxMembers = partySizeForCategory(
    (dungeon as { category: string | null }).category,
  );

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
    const minCombatPower = Math.max(0, Math.trunc(Number(body.minCombatPower) || 0));
    const requiredClasses = Array.isArray(body.requiredClasses)
      ? body.requiredClasses.filter((value) => typeof value === "string" && value.trim())
      : [];
    const invitedFriendIds = Array.isArray(body.invitedFriendIds)
      ? [...new Set(
          body.invitedFriendIds.filter(
            (value) => typeof value === "string" && value.trim(),
          ),
        )].slice(0, Math.max(0, maxMembers - 1))
      : [];

    if (invitedFriendIds.length > 0) {
      const { data: invitedFriends, error: invitedError } = await admin
        .from("friend_requests")
        .select("sender_id, receiver_id")
        .eq("status", "accepted")
        .or(
          `and(sender_id.eq.${user.id},receiver_id.in.(${invitedFriendIds.join(",")})),and(receiver_id.eq.${user.id},sender_id.in.(${invitedFriendIds.join(",")}))`,
        );

      if (invitedError) {
        return jsonError("초대 친구 확인에 실패했습니다: " + invitedError.message, 500);
      }

      const confirmedFriendIds = new Set(
        ((invitedFriends ?? []) as { sender_id: string; receiver_id: string }[])
          .map((row) => (row.sender_id === user.id ? row.receiver_id : row.sender_id)),
      );

      if (invitedFriendIds.some((friendId) => !confirmedFriendIds.has(friendId))) {
        return jsonError("친구인 사용자만 초대할 수 있습니다.", 400);
      }

      const { data: friendCharacters, error: characterError } = await admin
        .from("aion2_characters")
        .select("user_id, combat_power")
        .in("user_id", invitedFriendIds)
        .order("is_primary", { ascending: false })
        .order("synced_at", { ascending: false });

      if (characterError) {
        return jsonError("초대 친구 캐릭터 확인에 실패했습니다: " + characterError.message, 500);
      }

      const characterByUser = new Map<string, { combat_power: number }>();
      for (const character of (friendCharacters ?? []) as {
        user_id: string;
        combat_power: number;
      }[]) {
        if (!characterByUser.has(character.user_id)) {
          characterByUser.set(character.user_id, character);
        }
      }

      if (
        invitedFriendIds.some(
          (friendId) =>
            !characterByUser.has(friendId) ||
            (characterByUser.get(friendId)?.combat_power ?? 0) < minCombatPower,
        )
      ) {
        return jsonError("초대 친구 중 최소투력 조건을 충족하지 못한 사용자가 있습니다.", 400);
      }
    }

    const { error: cancelRequestError } = await admin
      .from("match_requests")
      .update({ status: "cancelled" } as unknown as never)
      .eq("leader_id", user.id)
      .in("status", ["waiting", "processing"]);

    if (cancelRequestError) {
      return jsonError("기존 매칭 요청 정리에 실패했습니다: " + cancelRequestError.message, 500);
    }

    const { error: cancelOwnQueueError } = await admin
      .from("match_queue")
      .update({ status: "cancelled" } as unknown as never)
      .eq("user_id", user.id)
      .in("status", ["waiting", "processing"]);

    if (cancelOwnQueueError) {
      return jsonError("기존 매칭 대기 정리에 실패했습니다: " + cancelOwnQueueError.message, 500);
    }

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
        invited_friend_ids: invitedFriendIds,
      } as unknown as never)
      .select(
        "id, leader_id, dungeon_id, character_row_id, required_stage, min_combat_power, required_classes, max_members, invited_friend_ids, created_at",
      )
      .single();

    if (error || !matchRequest) {
      return jsonError("매칭 요청 생성에 실패했습니다: " + (error?.message ?? ""), 500);
    }

    const result = await tryCompleteMatch(admin, matchRequest as MatchRequest);
    return NextResponse.json(result);
  }

  const { error: cancelQueueError } = await admin
    .from("match_queue")
    .update({ status: "cancelled" } as unknown as never)
    .eq("user_id", user.id)
    .in("status", ["waiting", "processing"]);

  if (cancelQueueError) {
    return jsonError("기존 대기열 정리에 실패했습니다: " + cancelQueueError.message, 500);
  }

  const { error: cancelOwnRequestError } = await admin
    .from("match_requests")
    .update({ status: "cancelled" } as unknown as never)
    .eq("leader_id", user.id)
    .in("status", ["waiting", "processing"]);

  if (cancelOwnRequestError) {
    return jsonError("기존 매칭 요청 정리에 실패했습니다: " + cancelOwnRequestError.message, 500);
  }

  const { data: queueEntry, error: queueError } = await admin.from("match_queue").insert(
    {
      user_id: user.id,
      dungeon_id: dungeonId,
      character_row_id: selectedCharacter.id,
      requested_stage: stage,
      status: "waiting",
    } as unknown as never,
  )
    .select("created_at")
    .single();

  if (queueError) {
    return jsonError("대기열 등록에 실패했습니다: " + queueError.message, 500);
  }

  const { data: requests, error: requestError } = await admin
    .from("match_requests")
    .select(
      "id, leader_id, dungeon_id, character_row_id, required_stage, min_combat_power, required_classes, max_members, invited_friend_ids",
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

  for (const matchRequest of (requests ?? []) as MatchRequest[]) {
    const result = await tryCompleteMatch(admin, matchRequest);
    if (result.matched) return NextResponse.json(result);
  }

  return NextResponse.json({
    matched: false,
    active: true,
    state: "waiting" satisfies MatchState,
    role: "member",
    since: (queueEntry as { created_at: string } | null)?.created_at,
  });
}
