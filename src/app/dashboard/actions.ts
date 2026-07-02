"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateRoomCode } from "@/lib/room-code";

const ROOM_TTL_HOURS = 6;

export async function createRoom() {
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
      created_by: user.id,
      expires_at: expiresAt,
    });

    if (!error) {
      redirect(`/room/${code}`);
    }

    // 23505 = unique_violation on the room code — retry with a fresh code.
    if (error.code !== "23505") {
      redirect("/dashboard?error=" + encodeURIComponent(error.message));
    }
  }

  redirect(
    "/dashboard?error=" +
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
