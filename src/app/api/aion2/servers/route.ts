import { NextResponse } from "next/server";
import { fetchServers } from "@/lib/aion2-api";

export async function GET() {
  try {
    const servers = await fetchServers();
    return NextResponse.json({ servers });
  } catch {
    return NextResponse.json(
      { error: "공식 홈페이지에서 서버 목록을 가져오지 못했습니다." },
      { status: 502 },
    );
  }
}
