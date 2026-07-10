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
  normalized: {
    equipment: unknown[];
    daevanionBoards: unknown[];
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
  const normalizedEquipment = equipment.map(normalizeEquipmentForRender);
  const normalizedDaevanionBoards = normalizeDaevanionBoards(boardList, daevanionDetails);

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
    normalized: {
      equipment: normalizedEquipment,
      daevanionBoards: normalizedDaevanionBoards,
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

function normalizeEquipmentForRender(item: unknown) {
  const record = asRecord(item) ?? {};
  const detail = asRecord(record.detail) ?? {};
  const grade = String(detail.grade ?? record.grade ?? "");
  const subStats = asArray(detail.subStats).map(normalizeSoulOption);

  return {
    itemId: record.id ?? detail.id,
    name: record.name ?? detail.name,
    grade,
    gradeName: formatGradeName(detail.gradeName ?? record.grade),
    gradeColor: getEquipmentGradeColor(grade),
    iconUrl: record.icon ?? detail.icon,
    enchantLevel: record.enchantLevel ?? detail.enchantLevel,
    exceedLevel: record.exceedLevel,
    level: detail.level,
    levelValue: detail.levelValue,
    slotIndex: record.slotPos,
    slotName: record.slotPosName,
    layoutGroup: getEquipmentLayoutGroup(String(record.slotPosName ?? "")),
    categoryName: detail.categoryName,
    soulBindRate: detail.soulBindRate,
    mainStats: normalizeStats(asArray(detail.mainStats)),
    soulOptions: subStats,
    magicStones: normalizeStats(asArray(detail.magicStoneStat)),
    godStones: asArray(detail.godStoneStat).map(normalizeNamedOption),
    subSkills: asArray(detail.subSkills).map(normalizeNamedOption),
  };
}

function normalizeStats(stats: unknown[]) {
  return stats.map((stat) => {
    const record = asRecord(stat) ?? {};
    return {
      id: record.id,
      name: record.name,
      value: record.value,
      extra: record.extra,
      icon: record.icon,
      grade: formatGradeName(record.grade),
      slotPos: record.slotPos,
    };
  });
}

function normalizeNamedOption(option: unknown) {
  const record = asRecord(option) ?? {};
  return {
    id: record.id,
    name: record.name,
    value: record.value,
    desc: record.desc,
    icon: record.icon,
    grade: formatGradeName(record.grade),
    level: record.level,
    slotPos: record.slotPos,
  };
}

function normalizeSoulOption(option: unknown) {
  const normalized = normalizeNamedOption(option);
  const tier = getSoulInscriptionTier(normalized.name);
  return {
    ...normalized,
    tier,
    color: getSoulTierColor(tier),
  };
}

function normalizeDaevanionBoards(boards: unknown[], details: unknown[]) {
  const detailById = new Map(
    details.map((detail) => {
      const record = asRecord(detail) ?? {};
      return [String(record.boardId), asRecord(record.data) ?? record];
    }),
  );

  return boards.map((board) => {
    const record = asRecord(board) ?? {};
    const detail = detailById.get(String(record.id));
    const nodes = asArray(detail?.nodeList).map((node) => {
      const nodeRecord = asRecord(node) ?? {};
      const grade = String(nodeRecord.grade ?? "common");
      return {
        boardId: nodeRecord.boardId ?? record.id,
        nodeId: nodeRecord.nodeId,
        name: nodeRecord.name,
        row: nodeRecord.row,
        col: nodeRecord.col,
        grade,
        open: Boolean(nodeRecord.open),
        icon: nodeRecord.icon,
        effects: asArray(nodeRecord.effectList),
        color: getDaevanionGradeColor(grade),
      };
    });

    return {
      id: record.id,
      name: record.name,
      icon: record.icon,
      totalNodeCount: record.totalNodeCount,
      openNodeCount: record.openNodeCount,
      openPercent: record.openPercent,
      nodes,
    };
  });
}

function getEquipmentLayoutGroup(slotName: string) {
  if (["MainHand", "SubHand"].includes(slotName)) return "weapons";
  if (["Helmet", "Shoulder", "Torso", "Pants", "Gloves", "Boots", "Cape"].includes(slotName)) return "armors";
  if (slotName.startsWith("Rune")) return "runes";
  if (slotName.startsWith("Arcana")) return "arcana";
  return "accessories";
}

function getGradeKey(grade: unknown) {
  const value = String(grade ?? "").trim().toLowerCase();
  if (value.includes("epic") || value.includes("영웅")) return "epic";
  if (value.includes("unique") || value.includes("유일")) return "unique";
  if (value.includes("legend") || value.includes("전승")) return "legend";
  if (value.includes("rare") || value.includes("희귀")) return "rare";
  if (value.includes("common") || value.includes("normal") || value.includes("일반")) return "common";
  return "";
}

function formatGradeName(grade: unknown) {
  const key = getGradeKey(grade);
  if (key === "epic") return "영웅";
  if (key === "unique") return "유일";
  if (key === "legend") return "전승";
  if (key === "rare") return "희귀";
  if (key === "common") return "일반";
  return grade;
}

function getEquipmentGradeColor(grade: string) {
  const key = getGradeKey(grade);
  if (key === "epic") return "#FF6B35";
  if (key === "unique") return "#FFD700";
  if (key === "legend") return "#4a90e2";
  if (key === "rare") return "#4caf50";
  return "#a0a0a0";
}

function getDaevanionGradeColor(grade: string) {
  const key = getGradeKey(grade);
  if (key === "unique") return { bg: "rgba(250, 204, 21, 0.15)", border: "#facc15", glow: "rgba(250, 204, 21, 0.6)" };
  if (key === "legend") return { bg: "rgba(96, 165, 250, 0.15)", border: "#60a5fa", glow: "rgba(96, 165, 250, 0.6)" };
  if (key === "rare") return { bg: "rgba(74, 222, 128, 0.15)", border: "#4ade80", glow: "rgba(74, 222, 128, 0.6)" };
  return { bg: "rgba(200, 200, 200, 0.15)", border: "#a0a0a0", glow: "rgba(200, 200, 200, 0.6)" };
}

function getSoulInscriptionTier(optionName: unknown) {
  if (!optionName) return "C";
  const name = String(optionName).trim();

  const sTierGodStones = ["회상[카이시넬]", "시간[시엘]", "파괴[지켈]", "죽음[트리니엘]", "자유[바이젤]", "지혜[루미엘]"];
  const aTierGodStones = ["정의[아자치]", "공간[이스라펠]"];
  if (sTierGodStones.some((option) => name.includes(option))) return "S";
  if (aTierGodStones.some((option) => name.includes(option))) return "A";

  const sTierOptions = ["무기 피해 증폭", "전투 속도", "피해 증폭", "치명타 피해 증폭", "위력", "다단 히트 적중", "정확"];
  const bTierOptions = ["막기", "비행", "회피", "생명력", "최대 생명력", "피해 내성", "방어력", "치명타 방어", "마법 공격력", "정신력", "치명타 저항", "강화 저항", "환경 저항", "상태이상 저항", "상태이상 적중", "천령 관련", "재생 관련", "재생", "천령"];
  const aTierOptions = ["이동 속도", "공격력", "공격력 증가", "강화", "치명타", "명중"];

  if (sTierOptions.some((option) => name.includes(option))) return "S";
  if (bTierOptions.some((option) => name.includes(option))) return "B";
  if (aTierOptions.some((option) => name === option || name.includes(option))) return "A";
  return "B";
}

function getSoulTierColor(tier: string) {
  if (tier === "S") return "#facc15";
  if (tier === "A") return "#60a5fa";
  if (tier === "B") return "#4ade80";
  return "#888888";
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
  _className?: string | null,
  _serverId?: number | string | null,
  _characterName?: string | null,
) {
  void _className;
  void _serverId;
  void _characterName;
  // Skill descriptions are intentionally not fetched from third-party pages.
  // Official AION2 data is returned as-is; rendering uses our own normalization.
  return Array.isArray(skills) ? skills : [];
}

