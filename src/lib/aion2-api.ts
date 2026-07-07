// Server-side client for aion2.plaync.com's internal APIs (the same ones
// the official 캐릭터 정보실 page calls). Unofficial — NC can change these
// at any time, so every caller should treat failures as expected. Responses
// are cached via Next's fetch cache to keep our traffic to them minimal.

const BASE = "https://aion2.plaync.com";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: "https://aion2.plaync.com/ko-kr/characters/index",
};

export type Aion2Server = {
  raceId: number;
  serverId: number;
  serverName: string;
  serverShortName: string;
};

export type Aion2SearchResult = {
  characterId: string;
  name: string;
  race: number;
  pcId: number;
  level: number;
  serverId: number;
  serverName: string;
};

export type Aion2CharacterProfile = {
  characterId: string;
  characterName: string;
  serverId: number;
  serverName: string;
  className: string;
  characterLevel: number;
  combatPower: number;
  equipment: unknown[];
  skills: unknown[];
  stigmas: unknown[];
};

type SkillDescription = {
  description?: string;
  notes?: string;
};

type SkillDescriptionGroup = Record<string, SkillDescription>;

type JobSkillDescriptions = {
  active?: SkillDescriptionGroup;
  passive?: SkillDescriptionGroup;
  stigma?: SkillDescriptionGroup;
};

const atoolDescriptionCache = new Map<string, Promise<JobSkillDescriptions | null>>();

async function plaync<T>(path: string, revalidateSeconds: number): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: HEADERS,
    next: { revalidate: revalidateSeconds },
  });
  if (!res.ok) {
    throw new Error(`plaync ${path} responded ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchServers(): Promise<Aion2Server[]> {
  const data = await plaync<{ serverList: Aion2Server[] }>(
    "/api/gameinfo/servers?lang=ko-kr",
    3600,
  );
  return data.serverList;
}

export async function searchCharacters(
  keyword: string,
  serverId: number,
  race: number,
): Promise<Aion2SearchResult[]> {
  const params = new URLSearchParams({
    keyword,
    race: String(race),
    serverId: String(serverId),
    page: "1",
    size: "10",
  });
  const data = await plaync<{ list: Aion2SearchResult[] }>(
    `/api/search/character?${params}`,
    60,
  );
  return data.list.map((c) => ({
    ...c,
    // Search returns the id URL-encoded and the name wrapped in the match
    // highlight markup the official site renders.
    characterId: decodeURIComponent(c.characterId),
    name: c.name.replace(/<[^>]*>/g, ""),
  }));
}

export async function fetchCharacterInfo(
  characterId: string,
  serverId: number,
): Promise<Aion2CharacterProfile> {
  const infoParams = new URLSearchParams({
    lang: "ko-kr",
    characterId,
    serverId: String(serverId),
  });

  const equipmentParams = new URLSearchParams({
    lang: "ko",
    characterId,
    serverId: String(serverId),
  });

  const [infoData, equipmentData] = await Promise.all([
    plaync<{
      profile: Omit<Aion2CharacterProfile, "equipment" | "skills" | "stigmas">;
    }>(`/api/character/info?${infoParams}`, 60),
    plaync<Aion2EquipmentResponse>(
      `/api/character/equipment?${equipmentParams}`,
      60,
    ).catch(() => null),
  ]);

  const skillList = await enrichAion2SkillsWithDescriptions(
    equipmentData?.skill?.skillList ?? [],
    infoData.profile.className,
    infoData.profile.serverId,
    infoData.profile.characterName,
  ).catch(() => equipmentData?.skill?.skillList ?? []);

  return {
    ...infoData.profile,
    equipment: equipmentData?.equipment?.equipmentList ?? [],
    skills: skillList.filter((skill) => !isStigmaSkill(skill)),
    stigmas: skillList.filter(isStigmaSkill),
  };
}

type Aion2EquipmentResponse = {
  equipment?: {
    equipmentList?: unknown[];
  };
  skill?: {
    skillList?: unknown[];
  };
};

function isStigmaSkill(skill: unknown) {
  if (!skill || typeof skill !== "object") return false;
  const record = skill as Record<string, unknown>;
  const category = String(record.category ?? record.type ?? "").toLowerCase();
  return (
    category === "dp" ||
    category.includes("stigma") ||
    category.includes("스티그마")
  );
}

export async function enrichAion2SkillsWithDescriptions(
  skills: unknown[],
  className?: string | null,
  serverId?: number | string | null,
  characterName?: string | null,
) {
  if (!Array.isArray(skills) || skills.length === 0 || !className) return skills;

  const descriptions = await fetchAtoolSkillDescriptions(
    className,
    serverId,
    characterName,
  );
  if (!descriptions) return skills;

  return skills.map((skill) => {
    if (!skill || typeof skill !== "object" || Array.isArray(skill)) return skill;
    const record = skill as Record<string, unknown>;
    const name = typeof record.name === "string" ? extractBaseSkillName(record.name) : "";
    const type = getSkillDescriptionType(record);
    const found = findSkillDescription(descriptions, type, name);

    if (!found) return skill;
    return {
      ...record,
      description:
        typeof record.description === "string" && record.description.trim()
          ? record.description
          : found.description,
      notes:
        typeof record.notes === "string" && record.notes.trim()
          ? record.notes
          : found.notes,
    };
  });
}

async function fetchAtoolSkillDescriptions(
  className: string,
  serverId?: number | string | null,
  characterName?: string | null,
): Promise<JobSkillDescriptions | null> {
  const safeServerId = serverId ? String(serverId) : "1015";
  const safeCharacterName = characterName?.trim() || "삼촌";
  const cacheKey = `${className}:${safeServerId}:${safeCharacterName}`;
  const cached = atoolDescriptionCache.get(cacheKey);
  if (cached) return cached;

  const promise = fetchAtoolSkillDescriptionsUncached(
    className,
    safeServerId,
    safeCharacterName,
  ).catch(() => {
    atoolDescriptionCache.delete(cacheKey);
    return null;
  });
  atoolDescriptionCache.set(cacheKey, promise);
  return promise;
}

async function fetchAtoolSkillDescriptionsUncached(
  className: string,
  safeServerId: string,
  safeCharacterName: string,
): Promise<JobSkillDescriptions | null> {
  const url = `https://aion2tool.com/char/serverid=${encodeURIComponent(
    safeServerId,
  )}/${encodeURIComponent(safeCharacterName)}`;

  const res = await fetch(url, {
    headers: HEADERS,
    next: { revalidate: 3600 },
  });
  if (!res.ok) return null;

  const html = await res.text();
  const match = html.match(
    /<script[^>]*id=["']skill-descriptions-data["'][^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match?.[1]) return null;

  const parsed = JSON.parse(match[1]) as Record<string, JobSkillDescriptions>;
  return parsed[className] ?? null;
}

function getSkillDescriptionType(skill: Record<string, unknown>) {
  const category = String(skill.category ?? skill.type ?? "").toLowerCase();
  if (category === "passive" || category.includes("passive")) return "passive";
  if (
    category === "dp" ||
    category.includes("stigma") ||
    category.includes("스티그마")
  ) {
    return "stigma";
  }
  return "active";
}

function findSkillDescription(
  descriptions: JobSkillDescriptions,
  type: string,
  name: string,
) {
  const typed = descriptions[type as keyof JobSkillDescriptions]?.[name];
  if (typed) return typed;

  return (
    descriptions.active?.[name] ??
    descriptions.passive?.[name] ??
    descriptions.stigma?.[name]
  );
}

function extractBaseSkillName(name: string) {
  return name.split(/[→?]/)[0]?.trim() ?? name.trim();
}
