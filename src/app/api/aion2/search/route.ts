import { NextRequest, NextResponse } from "next/server";
import { fetchServers, searchCharacters } from "@/lib/aion2-api";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, {
    scope: "aion2-search",
    limit: 30,
    windowSeconds: 60,
  });
  if (limited) return limited;

  const name = request.nextUrl.searchParams.get("name")?.trim();
  const serverId = Number(request.nextUrl.searchParams.get("serverId"));

  if (!name || !Number.isInteger(serverId) || serverId <= 0) {
    return NextResponse.json(
      { error: "캐릭터 이름과 서버를 입력해주세요." },
      { status: 400 },
    );
  }

  try {
    // The search API requires the race, but each Aion2 server belongs to
    // one race — derive it from the server list instead of asking the user.
    const servers = await fetchServers();
    const server = servers.find((s) => s.serverId === serverId);
    if (!server) {
      return NextResponse.json(
        { error: "존재하지 않는 서버입니다." },
        { status: 400 },
      );
    }

    const results = await searchCharacters(name, serverId, server.raceId);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json(
      { error: "공식 홈페이지 검색에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 },
    );
  }
}
