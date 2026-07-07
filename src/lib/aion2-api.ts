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
  const params = new URLSearchParams({
    lang: "ko-kr",
    characterId,
    serverId: String(serverId),
  });
  const data = await plaync<{ profile: Aion2CharacterProfile }>(
    `/api/character/info?${params}`,
    60,
  );
  return data.profile;
}
