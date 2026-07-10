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

export type Aion2CharacterDetailData = {
  profile: Record<string, unknown>;
  stats: unknown[];
  titles: Record<string, unknown>;
  rankings: unknown[];
  equipment: {
    all: unknown[];
    weapons: unknown[];
    armors: unknown[];
    accessories: unknown[];
    runes: unknown[];
    arcana: unknown[];
    details: unknown[];
  };
  skins: unknown[];
  petwing: {
    pet: unknown | null;
    wing: unknown | null;
    wingSkin: unknown | null;
  };
  skills: {
    active: unknown[];
    passive: unknown[];
    dp: unknown[];
    equipped: unknown[];
  };
  daevanion: {
    boards: unknown[];
    details: unknown[];
  };
  summary: {
    combatPower: number;
    itemLevel: number;
    className: string;
    characterLevel: number;
    equipmentCount: number;
    skillCount: number;
    equippedSkillCount: number;
    daevanionOpenAverage: number;
  };
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
  detailData: Aion2CharacterDetailData;
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
    lang: "ko",
    characterId,
    serverId: String(serverId),
  });

  const equipmentParams = new URLSearchParams({
    lang: "ko",
    characterId,
    serverId: String(serverId),
  });

  const [infoData, equipmentData] = await Promise.all([
    plaync<Aion2InfoResponse>(`/api/character/info?${infoParams}`, 300),
    plaync<Aion2EquipmentResponse>(
      `/api/character/equipment?${equipmentParams}`,
      300,
    ).catch(() => null),
  ]);

  const equipmentList = asArray(equipmentData?.equipment?.equipmentList);
  const equipmentDetails = await fetchEquipmentDetails(
    equipmentList,
    characterId,
    serverId,
  );
  const equipmentWithDetails = mergeEquipmentDetails(
    equipmentList,
    equipmentDetails,
  );

  const rawSkillList = asArray(equipmentData?.skill?.skillList);
  const skillList = await enrichAion2SkillsWithDescriptions(
    rawSkillList,
    infoData.profile.className,
    infoData.profile.serverId,
    infoData.profile.characterName,
  ).catch(() => rawSkillList);

  const daevanionBoards = asArray(infoData.daevanion?.boardList);
  const daevanionDetails = await fetchDaevanionDetails(
    daevanionBoards,
    characterId,
    serverId,
  );

  const detailData = buildCharacterDetailData({
    infoData,
    equipmentData,
    equipment: equipmentWithDetails,
    equipmentDetails,
    skills: skillList,
    daevanionDetails,
  });

  return {
    ...infoData.profile,
    equipment: equipmentWithDetails,
    skills: skillList.filter((skill) => !isStigmaSkill(skill)),
    stigmas: skillList.filter(isStigmaSkill),
    detailData,
  };
}

type Aion2InfoResponse = {
  profile: Omit<Aion2CharacterProfile, "equipment" | "skills" | "stigmas" | "detailData">;
  stat?: {
    statList?: unknown[];
  };
  title?: Record<string, unknown>;
  ranking?: {
    rankingList?: unknown[];
  };
  daevanion?: {
    boardList?: unknown[];
  };
};

type Aion2EquipmentResponse = {
  equipment?: {
    equipmentList?: unknown[];
    skinList?: unknown[];
  };
  petwing?: {
    pet?: unknown;
    wing?: unknown;
    wingSkin?: unknown;
  };
  skill?: {
    skillList?: unknown[];
  };
};

type EquipmentDetailResult = {
  slotPos?: unknown;
  slotPosName?: unknown;
  id?: unknown;
  data?: unknown;
  error?: string;
};

async function fetchEquipmentDetails(
  equipment: unknown[],
  characterId: string,
  serverId: number,
) {
  return mapLimit(equipment, 4, async (item): Promise<EquipmentDetailResult> => {
    const record = asRecord(item);
    const id = record?.id;
    const slotPos = record?.slotPos;
    const enchantLevel = record?.enchantLevel ?? 0;
    if (id === undefined || slotPos === undefined) {
      return {
        id,
        slotPos,
        slotPosName: record?.slotPosName,
        error: "missing equipment id or slotPos",
      };
    }

    const params = new URLSearchParams({
      lang: "ko",
      id: String(id),
      enchantLevel: String(enchantLevel),
      characterId,
      serverId: String(serverId),
      slotPos: String(slotPos),
    });

    try {
      const data = await plaync<unknown>(
        `/api/character/equipment/item?${params}`,
        300,
      );
      return { id, slotPos, slotPosName: record?.slotPosName, data };
    } catch (error) {
      return {
        id,
        slotPos,
        slotPosName: record?.slotPosName,
        error: error instanceof Error ? error.message : "equipment detail failed",
      };
    }
  });
}

async function fetchDaevanionDetails(
  boards: unknown[],
  characterId: string,
  serverId: number,
) {
  return mapLimit(boards, 4, async (board) => {
    const record = asRecord(board);
    const boardId = record?.id;
    if (boardId === undefined) return { boardId, error: "missing board id" };

    const params = new URLSearchParams({
      lang: "ko",
      characterId,
      serverId: String(serverId),
      boardId: String(boardId),
    });

    try {
      const data = await plaync<unknown>(
        `/api/character/daevanion/detail?${params}`,
        300,
      );
      return { boardId, data };
    } catch (error) {
      return {
        boardId,
        error: error instanceof Error ? error.message : "daevanion detail failed",
      };
    }
  });
}

function mergeEquipmentDetails(
  equipment: unknown[],
  details: EquipmentDetailResult[],
) {
  const bySlot = new Map(details.map((detail) => [String(detail.slotPos), detail]));
  return equipment.map((item) => {
    const record = asRecord(item);
    if (!record) return item;
    const detail = bySlot.get(String(record.slotPos));
    return detail?.data ? { ...record, detail: detail.data } : record;
  });
}

function buildCharacterDetailData({
  infoData,
  equipmentData,
  equipment,
  equipmentDetails,
  skills,
  daevanionDetails,
}: {
  infoData: Aion2InfoResponse;
  equipmentData: Aion2EquipmentResponse | null;
  equipment: unknown[];
  equipmentDetails: EquipmentDetailResult[];
  skills: unknown[];
  daevanionDetails: unknown[];
}): Aion2CharacterDetailData {
  const statList = asArray(infoData.stat?.statList);
  const boardList = asArray(infoData.daevanion?.boardList);
  const classifiedEquipment = classifyEquipment(equipment);
  const classifiedSkills = classifySkills(skills);

  return {
    profile: infoData.profile,
    stats: statList,
    titles: infoData.title ?? {},
    rankings: asArray(infoData.ranking?.rankingList),
    equipment: {
      all: equipment,
      ...classifiedEquipment,
      details: equipmentDetails,
    },
    skins: asArray(equipmentData?.equipment?.skinList),
    petwing: {
      pet: equipmentData?.petwing?.pet ?? null,
      wing: equipmentData?.petwing?.wing ?? null,
      wingSkin: equipmentData?.petwing?.wingSkin ?? null,
    },
    skills: classifiedSkills,
    daevanion: {
      boards: boardList,
      details: daevanionDetails,
    },
    summary: {
      combatPower: Number(infoData.profile.combatPower ?? 0),
      itemLevel: Number(findStatValue(statList, "ItemLevel") ?? 0),
      className: String(infoData.profile.className ?? ""),
      characterLevel: Number(infoData.profile.characterLevel ?? 0),
      equipmentCount: equipment.length,
      skillCount: skills.length,
      equippedSkillCount: classifiedSkills.equipped.length,
      daevanionOpenAverage: averageOpenPercent(boardList),
    },
  };
}

function classifyEquipment(equipment: unknown[]) {
  const weapons: unknown[] = [];
  const armors: unknown[] = [];
  const accessories: unknown[] = [];
  const runes: unknown[] = [];
  const arcana: unknown[] = [];

  for (const item of equipment) {
    const slot = String(asRecord(item)?.slotPosName ?? "");
    if (["MainHand", "SubHand"].includes(slot)) weapons.push(item);
    else if (["Helmet", "Shoulder", "Torso", "Pants", "Gloves", "Boots", "Cape"].includes(slot)) armors.push(item);
    else if (slot.startsWith("Rune")) runes.push(item);
    else if (slot.startsWith("Arcana")) arcana.push(item);
    else accessories.push(item);
  }

  return { weapons, armors, accessories, runes, arcana };
}

function classifySkills(skills: unknown[]) {
  const active: unknown[] = [];
  const passive: unknown[] = [];
  const dp: unknown[] = [];
  const equipped: unknown[] = [];

  for (const skill of skills) {
    const record = asRecord(skill);
    const category = String(record?.category ?? record?.type ?? "").toLowerCase();
    if (category === "passive") passive.push(skill);
    else if (category === "dp" || category.includes("stigma")) dp.push(skill);
    else active.push(skill);
    if (Number(record?.equip ?? record?.equipped ?? 0) === 1) equipped.push(skill);
  }

  return { active, passive, dp, equipped };
}

function findStatValue(stats: unknown[], type: string) {
  const found = stats.find((stat) => String(asRecord(stat)?.type ?? "") === type);
  return asRecord(found)?.value;
}

function averageOpenPercent(boards: unknown[]) {
  const values = boards
    .map((board) => Number(asRecord(board)?.openPercent))
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

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
