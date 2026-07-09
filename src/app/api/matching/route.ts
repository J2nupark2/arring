import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { generateRoomCode } from "@/lib/room-code";

const ROOM_TTL_HOURS = 6;
const MATCH_HEARTBEAT_TTL_MS = 2 * 60 * 1000;
const TEMPORARY_MATCH_RESPONSE_SECONDS = 30;
const MATCH_RESPONSE_BAN_MS = 5 * 60 * 1000;
const MATCH_TOP_K = 50;

type Profile = {
  id: string;
  nickname: string;
  server: string | null;
  manner_temperature: number | null;
  trust_temperature: number | null;
  matchmaking_banned_until?: string | null;
  consecutive_failed_response_count?: number | null;
  current_room_code?: string | null;
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
type MatchResponseStatus = "pending" | "accepted" | "rejected" | "expired";

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
  candidateScore?: number;
};

type TemporaryMatchStatus = {
  id: string;
  expiresAt: string;
  responseStatus: MatchResponseStatus;
  responses: { userId: string; status: MatchResponseStatus }[];
  score: number;
};

function activeHeartbeatCutoff() {
  return new Date(Date.now() - MATCH_HEARTBEAT_TTL_MS).toISOString();
}

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

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizeScore(value: number | null | undefined) {
  const numberValue = Number(value ?? 36.5);
  return numberValue <= 50 ? numberValue * 2 : numberValue;
}

function similarity(a: number | null | undefined, b: number | null | undefined) {
  return 1 - Math.min(Math.abs(normalizeScore(a) - normalizeScore(b)) / 100, 1);
}

function stddev(values: number[]) {
  if (values.length === 0) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function combinations<T>(items: T[], count: number) {
  const result: T[][] = [];
  const current: T[] = [];

  function walk(start: number) {
    if (current.length === count) {
      result.push([...current]);
      return;
    }
    for (let index = start; index <= items.length - (count - current.length); index++) {
      current.push(items[index]);
      walk(index + 1);
      current.pop();
    }
  }

  walk(0);
  return result;
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

async function expireStaleActiveMatches(admin: AdminClient) {
  const cutoff = activeHeartbeatCutoff();
  await Promise.all([
    admin
      .from("match_queue")
      .update({ status: "cancelled" } as unknown as never)
      .in("status", ["waiting", "processing"])
      .lt("heartbeat_at", cutoff),
    admin
      .from("match_requests")
      .update({ status: "cancelled" } as unknown as never)
      .in("status", ["waiting", "processing"])
      .lt("heartbeat_at", cutoff),
  ]);
}

async function touchActiveMatchHeartbeat(admin: AdminClient, userId: string) {
  const heartbeatAt = new Date().toISOString();
  await Promise.all([
    admin
      .from("match_queue")
      .update({ heartbeat_at: heartbeatAt } as unknown as never)
      .eq("user_id", userId)
      .in("status", ["waiting", "processing"]),
    admin
      .from("match_requests")
      .update({ heartbeat_at: heartbeatAt } as unknown as never)
      .eq("leader_id", userId)
      .in("status", ["waiting", "processing"]),
  ]);
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
    .gte("heartbeat_at", activeHeartbeatCutoff())
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

  const ids = [...new Set([...rows.map((row) => row.user_id), request.leader_id])];
  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select(
      "id, nickname, server, manner_temperature, trust_temperature, matchmaking_banned_until, consecutive_failed_response_count, current_room_code",
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
  const leaderProfile = profileById.get(request.leader_id);
  const requiredClasses = (request.required_classes ?? []).filter((className) =>
    className.trim(),
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
      if (profile.current_room_code) return false;
      if (
        profile.matchmaking_banned_until &&
        new Date(profile.matchmaking_banned_until).getTime() > Date.now()
      ) {
        return false;
      }
      if (character.combat_power < request.min_combat_power) return false;
      if (requiredClasses.length > 0 && !requiredClasses.includes(character.class_name)) {
        return false;
      }
      return true;
    })
    .map((candidate) => {
      const powerScore = clamp01(
        request.min_combat_power <= 0
          ? 1
          : candidate.character!.combat_power / Math.max(request.min_combat_power, 1),
      );
      const maxStage = Math.max(request.required_stage, candidate.row.requested_stage, 1);
      const gimmickScore = clamp01(candidate.row.requested_stage / maxStage);
      const classFitScore =
        requiredClasses.length === 0
          ? 1
          : requiredClasses.includes(candidate.character!.class_name)
            ? 1
            : 0;
      const mannerSimilarity = leaderProfile
        ? similarity(leaderProfile.manner_temperature, candidate.profile!.manner_temperature)
        : 1;
      const trustSimilarity = leaderProfile
        ? similarity(leaderProfile.trust_temperature, candidate.profile!.trust_temperature)
        : 1;

      return {
        ...candidate,
        candidateScore:
          powerScore * 0.3 +
          gimmickScore * 0.3 +
          classFitScore * 0.25 +
          mannerSimilarity * 0.075 +
          trustSimilarity * 0.075,
      };
    })
    .sort((a, b) => (b.candidateScore ?? 0) - (a.candidateScore ?? 0))
    .slice(0, MATCH_TOP_K);
}

function selectCandidatesForSlots(
  candidates: Candidate[],
  requiredClasses: string[],
  needed: number,
) {
  if (needed <= 0) return [];
  if (candidates.length < needed) return null;

  const fixedSlots = requiredClasses.filter((className) => className.trim()).slice(0, needed);
  let best: { candidates: Candidate[]; score: number } | null = null;

  for (const group of combinations(candidates, needed)) {
    const remainingClasses = [...fixedSlots];
    const classCompositionScore =
      remainingClasses.length === 0
        ? 1
        : group.every((candidate) => {
            const index = remainingClasses.indexOf(candidate.character?.class_name ?? "");
            if (index < 0) return false;
            remainingClasses.splice(index, 1);
            return true;
          })
          ? 1
          : 0;

    if (classCompositionScore <= 0) continue;

    const avgCandidateScore =
      group.reduce((sum, candidate) => sum + (candidate.candidateScore ?? 0), 0) /
      group.length;
    const combatPowers = group.map((candidate) => candidate.character?.combat_power ?? 0);
    const avgPower =
      combatPowers.reduce((sum, value) => sum + value, 0) / Math.max(combatPowers.length, 1);
    const powerBalanceScore = clamp01(1 - stddev(combatPowers) / Math.max(avgPower, 1));
    const minStage = Math.min(...group.map((candidate) => candidate.row.requested_stage));
    const maxStage = Math.max(...group.map((candidate) => candidate.row.requested_stage), 1);
    const gimmickCoverageScore = clamp01(minStage / maxStage);
    const mannerScores = group.map((candidate) =>
      normalizeScore(candidate.profile?.manner_temperature),
    );
    const trustScores = group.map((candidate) =>
      normalizeScore(candidate.profile?.trust_temperature),
    );
    const mannerHomogeneityScore = clamp01(1 - stddev(mannerScores) / 50);
    const trustHomogeneityScore = clamp01(1 - stddev(trustScores) / 50);
    const partyScore =
      avgCandidateScore * 0.25 +
      powerBalanceScore * 0.2 +
      gimmickCoverageScore * 0.2 +
      classCompositionScore * 0.2 +
      mannerHomogeneityScore * 0.075 +
      trustHomogeneityScore * 0.075;

    if (!best || partyScore > best.score) {
      best = { candidates: group, score: partyScore };
    }
  }

  return best?.candidates ?? null;
}

async function findPendingTemporaryMatch(
  admin: AdminClient,
  userId: string,
): Promise<TemporaryMatchStatus | null> {
  const { data: response } = await admin
    .from("match_responses")
    .select("temporary_match_id, status")
    .eq("user_id", userId)
    .in("status", ["pending", "accepted"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ownResponse = response as {
    temporary_match_id: string;
    status: MatchResponseStatus;
  } | null;
  if (!ownResponse) return null;

  const { data: temp } = await admin
    .from("temporary_matches")
    .select("id, status, expires_at, score")
    .eq("id", ownResponse.temporary_match_id)
    .eq("status", "pending_acceptance")
    .maybeSingle();

  const temporaryMatch = temp as {
    id: string;
    status: string;
    expires_at: string;
    score: number;
  } | null;
  if (!temporaryMatch) return null;

  const { data: responses } = await admin
    .from("match_responses")
    .select("user_id, status")
    .eq("temporary_match_id", temporaryMatch.id);

  return {
    id: temporaryMatch.id,
    expiresAt: temporaryMatch.expires_at,
    responseStatus: ownResponse.status,
    score: Number(temporaryMatch.score ?? 0),
    responses: ((responses ?? []) as { user_id: string; status: MatchResponseStatus }[]).map(
      (item) => ({ userId: item.user_id, status: item.status }),
    ),
  };
}

async function resetMatchLocks(
  admin: AdminClient,
  temp: {
    match_request_id: string;
    queue_ids: string[];
    leader_id: string;
    candidate_user_ids: string[];
  },
  penalizedUserIds = new Set<string>(),
) {
  const heartbeatAt = new Date().toISOString();
  const jobs = [];

  if (!penalizedUserIds.has(temp.leader_id)) {
    jobs.push(
      admin
        .from("match_requests")
        .update({ status: "waiting", heartbeat_at: heartbeatAt } as unknown as never)
        .eq("id", temp.match_request_id)
        .eq("status", "processing"),
    );
  } else {
    jobs.push(
      admin
        .from("match_requests")
        .update({ status: "cancelled" } as unknown as never)
        .eq("id", temp.match_request_id),
    );
  }

  const reusableQueueIds = temp.queue_ids.filter(
    (_, index) => !penalizedUserIds.has(temp.candidate_user_ids[index]),
  );
  const penalizedQueueIds = temp.queue_ids.filter((_, index) =>
    penalizedUserIds.has(temp.candidate_user_ids[index]),
  );

  if (reusableQueueIds.length > 0) {
    jobs.push(
      admin
        .from("match_queue")
        .update({
          status: "waiting",
          match_request_id: null,
          heartbeat_at: heartbeatAt,
        } as unknown as never)
        .in("id", reusableQueueIds)
        .eq("status", "processing"),
    );
  }

  if (penalizedQueueIds.length > 0) {
    jobs.push(
      admin
        .from("match_queue")
        .update({ status: "cancelled", match_request_id: null } as unknown as never)
        .in("id", penalizedQueueIds),
    );
  }

  await Promise.all(jobs);
}

async function penalizeFailedResponses(admin: AdminClient, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)];
  for (const userId of uniqueUserIds) {
    const { data } = await admin
      .from("profiles")
      .select("consecutive_failed_response_count")
      .eq("id", userId)
      .maybeSingle();
    const profile = data as { consecutive_failed_response_count: number | null } | null;
    const nextCount = (profile?.consecutive_failed_response_count ?? 0) + 1;
    await admin
      .from("profiles")
      .update({
        consecutive_failed_response_count: nextCount,
        matchmaking_banned_until:
          nextCount >= 2
            ? new Date(Date.now() + MATCH_RESPONSE_BAN_MS).toISOString()
            : null,
      } as unknown as never)
      .eq("id", userId);
  }
}

async function expirePendingTemporaryMatches(admin: AdminClient) {
  const { data: expiredMatches } = await admin
    .from("temporary_matches")
    .select("id, match_request_id, leader_id, candidate_user_ids, queue_ids")
    .eq("status", "pending_acceptance")
    .lt("expires_at", new Date().toISOString());

  for (const temp of (expiredMatches ?? []) as {
    id: string;
    match_request_id: string;
    leader_id: string;
    candidate_user_ids: string[];
    queue_ids: string[];
  }[]) {
    const { data: pendingResponses } = await admin
      .from("match_responses")
      .select("user_id")
      .eq("temporary_match_id", temp.id)
      .eq("status", "pending");
    const expiredUserIds = ((pendingResponses ?? []) as { user_id: string }[]).map(
      (item) => item.user_id,
    );
    await admin
      .from("match_responses")
      .update({
        status: "expired",
        responded_at: new Date().toISOString(),
      } as unknown as never)
      .eq("temporary_match_id", temp.id)
      .eq("status", "pending");
    await admin
      .from("temporary_matches")
      .update({ status: "expired", cancelled_reason: "timeout" } as unknown as never)
      .eq("id", temp.id)
      .eq("status", "pending_acceptance");
    await penalizeFailedResponses(admin, expiredUserIds);

    const banSet = new Set<string>();
    for (const userId of expiredUserIds) {
      const { data } = await admin
        .from("profiles")
        .select("consecutive_failed_response_count")
        .eq("id", userId)
        .maybeSingle();
      if (((data as { consecutive_failed_response_count: number } | null)?.consecutive_failed_response_count ?? 0) >= 2) {
        banSet.add(userId);
      }
    }
    await resetMatchLocks(admin, temp, banSet);
  }
}

async function createTemporaryMatch(
  admin: AdminClient,
  request: MatchRequest,
  chosen: Candidate[],
) {
  const expiresAt = new Date(
    Date.now() + TEMPORARY_MATCH_RESPONSE_SECONDS * 1000,
  ).toISOString();
  const partyScore =
    chosen.reduce((sum, candidate) => sum + (candidate.candidateScore ?? 0), 0) /
    Math.max(chosen.length, 1);
  const candidateUserIds = chosen.map(({ row }) => row.user_id);
  const queueIds = chosen.map(({ row }) => row.id);

  const { data: temp, error } = await admin
    .from("temporary_matches")
    .insert({
      match_request_id: request.id,
      leader_id: request.leader_id,
      candidate_user_ids: candidateUserIds,
      queue_ids: queueIds,
      status: "pending_acceptance",
      score: partyScore,
      expires_at: expiresAt,
    } as unknown as never)
    .select("id, expires_at")
    .single();

  if (error || !temp) throw new Error(error?.message ?? "temporary match failed");
  const temporaryMatch = temp as { id: string; expires_at: string };
  await admin.from("match_responses").insert(
    [request.leader_id, ...candidateUserIds].map((user_id) => ({
      temporary_match_id: temporaryMatch.id,
      user_id,
      status: "pending",
    })) as unknown as never,
  );

  return {
    matched: false,
    active: true,
    state: "processing" satisfies MatchState,
    temporaryMatch: {
      id: temporaryMatch.id,
      expiresAt: temporaryMatch.expires_at,
      responseStatus: "pending" satisfies MatchResponseStatus,
      responses: [request.leader_id, ...candidateUserIds].map((userId) => ({
        userId,
        status: "pending" satisfies MatchResponseStatus,
      })),
      score: partyScore,
    },
  };
}

async function confirmTemporaryMatch(admin: AdminClient, temporaryMatchId: string) {
  const { data: tempRow } = await admin
    .from("temporary_matches")
    .select("id, match_request_id, leader_id, candidate_user_ids, queue_ids, status")
    .eq("id", temporaryMatchId)
    .maybeSingle();
  const temp = tempRow as {
    id: string;
    match_request_id: string;
    leader_id: string;
    candidate_user_ids: string[];
    queue_ids: string[];
    status: string;
  } | null;
  if (!temp || temp.status !== "pending_acceptance") return null;

  const { data: responses } = await admin
    .from("match_responses")
    .select("status")
    .eq("temporary_match_id", temporaryMatchId);
  const responseRows = (responses ?? []) as { status: MatchResponseStatus }[];
  if (responseRows.length !== 5 || responseRows.some((row) => row.status !== "accepted")) {
    return null;
  }

  const { data: requestRow } = await admin
    .from("match_requests")
    .select(
      "id, leader_id, dungeon_id, character_row_id, required_stage, min_combat_power, required_classes, max_members, invited_friend_ids, created_at",
    )
    .eq("id", temp.match_request_id)
    .maybeSingle();
  const matchRequest = requestRow as MatchRequest | null;
  if (!matchRequest) return null;

  const { data: leaderProfile } = await admin
    .from("profiles")
    .select("id, nickname, server, manner_temperature, trust_temperature")
    .eq("id", temp.leader_id)
    .single();
  if (!leaderProfile) return null;

  const room = await createRoom(
    admin,
    leaderProfile as Profile,
    matchRequest,
    temp.candidate_user_ids,
  );
  const matchedAt = new Date().toISOString();
  await Promise.all([
    admin
      .from("temporary_matches")
      .update({
        status: "confirmed",
        room_id: room.id,
      } as unknown as never)
      .eq("id", temporaryMatchId),
    admin
      .from("match_requests")
      .update({
        status: "matched",
        room_id: room.id,
        matched_at: matchedAt,
      } as unknown as never)
      .eq("id", temp.match_request_id),
    admin
      .from("match_queue")
      .update({
        status: "matched",
        match_request_id: temp.match_request_id,
        room_id: room.id,
        matched_at: matchedAt,
      } as unknown as never)
      .in("id", temp.queue_ids),
    admin
      .from("profiles")
      .update({
        consecutive_failed_response_count: 0,
        matchmaking_banned_until: null,
      } as unknown as never)
      .in("id", [temp.leader_id, ...temp.candidate_user_ids]),
  ]);

  return room.code;
}

async function handleTemporaryMatchResponse(
  admin: AdminClient,
  userId: string,
  action: "accept" | "reject",
) {
  await expirePendingTemporaryMatches(admin);
  const pending = await findPendingTemporaryMatch(admin, userId);
  if (!pending) {
    return {
      matched: false,
      active: false,
      state: "idle" satisfies MatchState,
    };
  }

  const status = action === "accept" ? "accepted" : "rejected";
  const { error } = await admin
    .from("match_responses")
    .update({ status, responded_at: new Date().toISOString() } as unknown as never)
    .eq("temporary_match_id", pending.id)
    .eq("user_id", userId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);

  if (action === "reject") {
    const { data: tempRow } = await admin
      .from("temporary_matches")
      .select("id, match_request_id, leader_id, candidate_user_ids, queue_ids")
      .eq("id", pending.id)
      .maybeSingle();
    const temp = tempRow as {
      id: string;
      match_request_id: string;
      leader_id: string;
      candidate_user_ids: string[];
      queue_ids: string[];
    } | null;
    if (temp) {
      await admin
        .from("temporary_matches")
        .update({
          status: "cancelled",
          cancelled_reason: "rejected",
        } as unknown as never)
        .eq("id", pending.id)
        .eq("status", "pending_acceptance");
      await penalizeFailedResponses(admin, [userId]);
      const { data: profile } = await admin
        .from("profiles")
        .select("consecutive_failed_response_count")
        .eq("id", userId)
        .maybeSingle();
      const banSet = new Set<string>();
      if (
        ((profile as { consecutive_failed_response_count: number } | null)
          ?.consecutive_failed_response_count ?? 0) >= 2
      ) {
        banSet.add(userId);
      }
      await resetMatchLocks(admin, temp, banSet);
    }
    return {
      matched: false,
      active: false,
      state: "cancelled" satisfies MatchState,
    };
  }

  const roomCode = await confirmTemporaryMatch(admin, pending.id);
  if (roomCode) {
    return { matched: true, active: false, state: "matched" satisfies MatchState, roomCode };
  }

  const nextPending = await findPendingTemporaryMatch(admin, userId);
  return {
    matched: false,
    active: true,
    state: "processing" satisfies MatchState,
    temporaryMatch: nextPending,
  };
}

async function tryCompleteMatch(
  admin: AdminClient,
  request: MatchRequest,
) {
  const heartbeatAt = new Date().toISOString();
  const { data: claimedRequest, error: claimError } = await admin
    .from("match_requests")
    .update({ status: "processing", heartbeat_at: heartbeatAt } as unknown as never)
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
      "id, nickname, server, manner_temperature, trust_temperature, matchmaking_banned_until, current_room_code",
    )
    .eq("id", activeRequest.leader_id)
    .single();

  if (leaderError || !leaderProfile) {
    throw new Error(leaderError?.message ?? "파티장 정보를 찾을 수 없습니다.");
  }

  const leader = leaderProfile as Profile;
  if (
    leader.current_room_code ||
    (leader.matchmaking_banned_until &&
      new Date(leader.matchmaking_banned_until).getTime() > Date.now())
  ) {
    await admin
      .from("match_requests")
      .update({ status: "cancelled" } as unknown as never)
      .eq("id", activeRequest.id);
    return {
      matched: false,
      active: false,
      state: "cancelled" satisfies MatchState,
    };
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
      .update({
        status: "waiting",
        heartbeat_at: new Date().toISOString(),
      } as unknown as never)
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
        heartbeat_at: new Date().toISOString(),
      } as unknown as never)
      .select("id")
      .in("id", chosenQueueIds)
      .eq("status", "waiting");

    if (claimQueueError) throw new Error(claimQueueError.message);

    if ((claimedQueues ?? []).length !== chosenQueueIds.length) {
      await admin
        .from("match_requests")
        .update({
          status: "waiting",
          heartbeat_at: new Date().toISOString(),
        } as unknown as never)
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

  try {
    return await createTemporaryMatch(admin, activeRequest, chosen);
  } catch (error) {
    await resetMatchLocks(admin, {
      match_request_id: activeRequest.id,
      leader_id: activeRequest.leader_id,
      candidate_user_ids: chosen.map(({ row }) => row.user_id),
      queue_ids: chosenQueueIds,
    });
    throw error;
  }
}

async function getMatchStatus(
  admin: AdminClient,
  userId: string,
  matchedAfter?: string | null,
) {
  const pendingTemporaryMatch = await findPendingTemporaryMatch(admin, userId);
  if (pendingTemporaryMatch) {
    return {
      matched: false,
      active: true,
      state: "processing" satisfies MatchState,
      temporaryMatch: pendingTemporaryMatch,
    };
  }

  const existing = await findExistingMatch(admin, userId, matchedAfter);
  if (existing.matched) return { ...existing, state: "matched" satisfies MatchState, active: false };

  const { data: activeRequestRow } = await admin
    .from("match_requests")
    .select("id, leader_id, dungeon_id, character_row_id, required_stage, min_combat_power, required_classes, max_members, invited_friend_ids, created_at, status")
    .eq("leader_id", userId)
    .in("status", ["waiting", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeRequestRow) {
    const activeRequest = activeRequestRow as {
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

  const { data: activeQueueRow } = await admin
    .from("match_queue")
    .select("created_at, status")
    .eq("user_id", userId)
    .in("status", ["waiting", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeQueueRow) {
    const activeQueue = activeQueueRow as { created_at: string; status: MatchState };
    return {
      matched: false,
      active: true,
      state: activeQueue.status,
      role: "member",
      since: activeQueue.created_at,
      status: activeQueue.status,
    };
  }

  const [{ data: cancelledRequest }, { data: cancelledQueue }] = await Promise.all([
    admin
      .from("match_requests")
      .select("created_at, status")
      .eq("leader_id", userId)
      .eq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("match_queue")
      .select("created_at, status")
      .eq("user_id", userId)
      .eq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const cancelledRows = [
    cancelledRequest
      ? { ...(cancelledRequest as { created_at: string; status: MatchState }), role: "leader" as const }
      : null,
    cancelledQueue
      ? { ...(cancelledQueue as { created_at: string; status: MatchState }), role: "member" as const }
      : null,
  ].filter((row): row is { created_at: string; status: MatchState; role: "leader" | "member" } => !!row);

  const latestCancelled = cancelledRows.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0];

  if (latestCancelled) {
    return {
      matched: false,
      active: false,
      state: "cancelled" satisfies MatchState,
      role: latestCancelled.role,
      since: latestCancelled.created_at,
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

  await expireStaleActiveMatches(admin);
  await expirePendingTemporaryMatches(admin);
  await touchActiveMatchHeartbeat(admin, user.id);

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

  await expireStaleActiveMatches(admin);
  await expirePendingTemporaryMatches(admin);

  const pendingTemporaryMatch = await findPendingTemporaryMatch(admin, user.id);
  if (pendingTemporaryMatch) {
    return NextResponse.json(
      await handleTemporaryMatchResponse(admin, user.id, "reject"),
    );
  }

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

export async function PATCH(request: NextRequest) {
  const admin = getAdmin();
  if (!admin) {
    return jsonError("?쒕쾭??SUPABASE_SERVICE_ROLE_KEY媛 ?ㅼ젙?섏? ?딆븯?듬땲??", 500);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return jsonError("濡쒓렇?몄씠 ?꾩슂?⑸땲??", 401);

  let body: { action?: "accept" | "reject" };
  try {
    body = await request.json();
  } catch {
    return jsonError("?섎せ???붿껌?낅땲??", 400);
  }

  if (body.action !== "accept" && body.action !== "reject") {
    return jsonError("응답 값이 올바르지 않습니다.", 400);
  }

  try {
    const result = await handleTemporaryMatchResponse(admin, user.id, body.action);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "매칭 응답 처리에 실패했습니다.",
      500,
    );
  }
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

  await expireStaleActiveMatches(admin);
  await expirePendingTemporaryMatches(admin);

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

  const { data: matchingPenalty } = await admin
    .from("profiles")
    .select("matchmaking_banned_until")
    .eq("id", user.id)
    .maybeSingle();
  const bannedUntil = (matchingPenalty as { matchmaking_banned_until: string | null } | null)
    ?.matchmaking_banned_until;
  if (bannedUntil && new Date(bannedUntil).getTime() > Date.now()) {
    return jsonError(
      `매칭 제한 중입니다. ${new Date(bannedUntil).toLocaleTimeString("ko-KR")} 이후 다시 시도해주세요.`,
      429,
    );
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
        heartbeat_at: new Date().toISOString(),
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
      heartbeat_at: new Date().toISOString(),
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
    .gte("heartbeat_at", activeHeartbeatCutoff())
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
