import { NextRequest, NextResponse } from "next/server";
import { fetchCharacterInfo, type Aion2CharacterProfile } from "@/lib/aion2-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/rate-limit";

const CHARACTER_CACHE_MS = 60_000;

type CachedCharacter = {
  id: string;
  synced_at: string;
};

function pickList(source: unknown, keys: string[]) {
  if (!source || typeof source !== "object") return [];
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key];
  }
  return [];
}

function isFresh(syncedAt?: string | null) {
  return !!syncedAt && Date.now() - new Date(syncedAt).getTime() < CHARACTER_CACHE_MS;
}

function characterValues(profile: Aion2CharacterProfile, syncedAt: string) {
  const rawProfile = profile as unknown;
  return {
    character_id: profile.characterId,
    character_name: profile.characterName,
    server_id: profile.serverId,
    server_name: profile.serverName,
    class_name: profile.className,
    character_level: profile.characterLevel,
    combat_power: profile.combatPower,
    equipment: pickList(rawProfile, ["equipment", "equipments", "items", "itemList"]),
    skills: pickList(rawProfile, ["skills", "skillList"]),
    stigmas: pickList(rawProfile, ["stigmas", "stigmaList"]),
    detail_data: profile.detailData,
    synced_at: syncedAt,
  };
}

export async function POST(request: NextRequest) {
  let body: { characterId?: string; serverId?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const characterId = body.characterId?.trim();
  const serverId = Number(body.serverId);
  if (!characterId || !Number.isInteger(serverId) || serverId <= 0) {
    return NextResponse.json({ error: "캐릭터와 서버 정보가 필요합니다." }, { status: 400 });
  }

  const limited = await enforceRateLimit(request, {
    scope: "aion2-view",
    limit: 20,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const admin = createAdminClient();
  const { data: cached } = await admin
    .from("aion2_characters")
    .select("id, synced_at")
    .eq("character_id", characterId)
    .eq("server_id", serverId)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle<CachedCharacter>();

  if (cached && isFresh(cached.synced_at)) {
    return NextResponse.json({ character: { id: cached.id, fromCache: true } });
  }

  let profile: Aion2CharacterProfile;
  try {
    profile = await fetchCharacterInfo(characterId, serverId);
  } catch {
    return NextResponse.json(
      { error: "공식 정보실에서 캐릭터 정보를 가져오지 못했습니다." },
      { status: 502 },
    );
  }

  if (!profile.characterName || typeof profile.combatPower !== "number") {
    return NextResponse.json({ error: "캐릭터 정보를 찾을 수 없습니다." }, { status: 404 });
  }

  const syncedAt = new Date().toISOString();
  const values = characterValues(profile, syncedAt);

  if (cached) {
    const { error } = await admin
      .from("aion2_characters")
      .update(values as never)
      .eq("character_id", characterId)
      .eq("server_id", serverId);
    if (error) {
      return NextResponse.json({ error: "캐릭터 캐시 갱신에 실패했습니다." }, { status: 500 });
    }
    return NextResponse.json({ character: { id: cached.id, fromCache: false } });
  }

  const { data: created, error: createError } = await admin
    .from("aion2_characters")
    .insert({ ...values, user_id: null, is_primary: false } as never)
    .select("id")
    .single<{ id: string }>();

  if (createError || !created) {
    const { data: concurrent } = await admin
      .from("aion2_characters")
      .select("id")
      .eq("character_id", characterId)
      .eq("server_id", serverId)
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (concurrent) {
      return NextResponse.json({ character: { id: concurrent.id, fromCache: false } });
    }
    return NextResponse.json({ error: "캐릭터 캐시 저장에 실패했습니다." }, { status: 500 });
  }

  return NextResponse.json({ character: { id: created.id, fromCache: false } });
}
