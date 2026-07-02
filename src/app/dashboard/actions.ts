"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateRoomCode } from "@/lib/room-code";

const ROOM_TTL_HOURS = 6;
const MIN_MEMBERS = 2;
const MAX_MEMBERS = 12;

export async function createRoom(formData: FormData) {
  const title = ((formData.get("title") as string) ?? "").trim() || "파티 통화방";
  const isPublic = formData.get("isPublic") === "on";
  const maxMembersRaw = (formData.get("maxMembers") as string | null)?.trim();
  const parsedMax = maxMembersRaw ? Number(maxMembersRaw) : NaN;
  const maxMembers = Number.isFinite(parsedMax)
    ? Math.min(Math.max(Math.trunc(parsedMax), MIN_MEMBERS), MAX_MEMBERS)
    : 6;

  // Public party posts come from the /party page; plain rooms from /dashboard.
  const errorPath = isPublic ? "/party" : "/dashboard";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const expiresAt = new Date(
    Date.now() + ROOM_TTL_HOURS * 60 * 60 * 1000,
  ).toISOString();

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const { error } = await supabase.from("rooms").insert({
      code,
      title,
      max_members: maxMembers,
      is_public: isPublic,
      created_by: user.id,
      expires_at: expiresAt,
    });

    if (!error) {
      redirect(`/room/${code}`);
    }

    // 23505 = unique_violation on the room code — retry with a fresh code.
    if (error.code !== "23505") {
      redirect(`${errorPath}?error=` + encodeURIComponent(error.message));
    }
  }

  redirect(
    `${errorPath}?error=` +
      encodeURIComponent("통화방 코드 생성에 실패했습니다. 다시 시도해주세요."),
  );
}

export async function joinRoomByCode(formData: FormData) {
  const code = (formData.get("code") as string)?.trim().toUpperCase();

  if (!code) {
    redirect("/dashboard?error=" + encodeURIComponent("방 코드를 입력해주세요."));
  }

  redirect(`/room/${code}`);
}
