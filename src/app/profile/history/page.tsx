import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import {
  PlayHistoryClient,
  type PlayHistoryItem,
} from "@/components/profile/play-history-client";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RoomRow = {
  id: string;
  code: string;
  title: string;
  status: string;
};

type ParticipantRow = {
  room_id: string;
  user_id: string;
  joined_at: string;
  left_at: string | null;
};

type ProfileRow = {
  id: string;
  nickname: string;
  server: string | null;
};

type CharacterRow = {
  id: string;
  user_id: string;
};

type MatchRequestRow = {
  room_id: string | null;
  dungeon_id: string;
  required_stage: number;
};

type DungeonRow = {
  id: string;
  name: string;
};

type EvaluationRow = {
  party_id: string;
  target_user_id: string;
};

export default async function PlayHistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/guest?next=${encodeURIComponent("/profile/history")}`);
  }

  if (user.is_anonymous) {
    redirect("/party");
  }

  const { data: ownRows } = await supabase
    .from("room_participants")
    .select("room_id, user_id, joined_at, left_at")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: false })
    .limit(30);

  const ownHistoryRows = (ownRows ?? []) as ParticipantRow[];
  const roomIds = [...new Set(ownHistoryRows.map((row) => row.room_id))];

  const empty = (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <PlayHistoryClient items={[]} />
      </main>
    </>
  );

  if (roomIds.length === 0) return empty;

  const [
    { data: rooms },
    { data: participants },
    { data: matchRequests },
    { data: evaluations },
  ] = await Promise.all([
    supabase.from("rooms").select("id, code, title, status").in("id", roomIds),
    supabase
      .from("room_participants")
      .select("room_id, user_id, joined_at, left_at")
      .in("room_id", roomIds),
    supabase
      .from("match_requests")
      .select("room_id, dungeon_id, required_stage")
      .in("room_id", roomIds),
    supabase
      .from("party_evaluations")
      .select("party_id, target_user_id")
      .eq("evaluator_user_id", user.id)
      .in("party_id", roomIds),
  ]);

  const participantRows = (participants ?? []) as ParticipantRow[];
  const otherUserIds = [
    ...new Set(
      participantRows
        .map((row) => row.user_id)
        .filter((participantUserId) => participantUserId !== user.id),
    ),
  ];
  const dungeonIds = [
    ...new Set(
      ((matchRequests ?? []) as MatchRequestRow[]).map((request) => request.dungeon_id),
    ),
  ];

  const [{ data: profiles }, { data: characters }, { data: dungeons }] =
    await Promise.all([
      otherUserIds.length > 0
        ? supabase.from("profiles").select("id, nickname, server").in("id", otherUserIds)
        : Promise.resolve({ data: [] }),
      otherUserIds.length > 0
        ? supabase
            .from("aion2_characters")
            .select("id, user_id")
            .in("user_id", otherUserIds)
            .order("is_primary", { ascending: false })
            .order("synced_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      dungeonIds.length > 0
        ? supabase.from("dungeons").select("id, name").in("id", dungeonIds)
        : Promise.resolve({ data: [] }),
    ]);

  const roomById = new Map(((rooms ?? []) as RoomRow[]).map((room) => [room.id, room]));
  const profileById = new Map(
    ((profiles ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]),
  );
  const dungeonById = new Map(
    ((dungeons ?? []) as DungeonRow[]).map((dungeon) => [dungeon.id, dungeon]),
  );
  const characterByUserId = new Map<string, string>();
  for (const character of (characters ?? []) as CharacterRow[]) {
    if (!characterByUserId.has(character.user_id)) {
      characterByUserId.set(character.user_id, character.id);
    }
  }
  const matchByRoomId = new Map(
    ((matchRequests ?? []) as MatchRequestRow[]).map((request) => [
      request.room_id,
      request,
    ]),
  );
  const evaluatedKeys = new Set(
    ((evaluations ?? []) as EvaluationRow[]).map(
      (evaluation) => `${evaluation.party_id}:${evaluation.target_user_id}`,
    ),
  );

  const participantsByRoomId = new Map<string, ParticipantRow[]>();
  for (const participant of participantRows) {
    const current = participantsByRoomId.get(participant.room_id) ?? [];
    current.push(participant);
    participantsByRoomId.set(participant.room_id, current);
  }

  const items: PlayHistoryItem[] = ownHistoryRows
    .map((ownRow) => {
      const room = roomById.get(ownRow.room_id);
      if (!room) return null;

      const match = matchByRoomId.get(room.id);
      const partyParticipants = (participantsByRoomId.get(room.id) ?? [])
        .filter((participant) => participant.user_id !== user.id)
        .map((participant) => {
          const profile = profileById.get(participant.user_id);
          return {
            userId: participant.user_id,
            nickname: profile?.nickname ?? "알 수 없음",
            server: profile?.server ?? null,
            characterRowId: characterByUserId.get(participant.user_id) ?? null,
            alreadyEvaluated: evaluatedKeys.has(`${room.id}:${participant.user_id}`),
          };
        });

      return {
        roomId: room.id,
        roomCode: room.code,
        title: room.title,
        status: room.status,
        joinedAt: ownRow.joined_at,
        leftAt: ownRow.left_at,
        dungeonName: match ? dungeonById.get(match.dungeon_id)?.name ?? null : null,
        gimmickStage: match?.required_stage ?? null,
        participants: partyParticipants,
      };
    })
    .filter((item): item is PlayHistoryItem => item !== null);

  return (
    <>
      <AppHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <PlayHistoryClient items={items} />
      </main>
    </>
  );
}
