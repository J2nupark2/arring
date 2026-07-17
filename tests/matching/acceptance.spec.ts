import { expect, test, type Browser } from "@playwright/test";
import {
  acceptInUi,
  assertSingleRoom,
  createPartyHarness,
  createReplacementUser,
  queueParty,
  rejectInUi,
  setTemporaryExpiry,
  waitForTemporaryStatus,
  type PartyHarness,
} from "./helpers";

async function withParty(
  browser: Browser,
  size: 5 | 10,
  run: (harness: PartyHarness) => Promise<void>,
) {
  const harness = await createPartyHarness(browser, size);
  try {
    await run(harness);
  } finally {
    await harness.dispose();
  }
}

for (const size of [5, 10] as const) {
  test.describe(`${size}인 매칭 수락 순서`, () => {
    test("방장이 마지막으로 수락해도 전원이 동일한 방으로 이동한다", async ({ browser }) => {
      await withParty(browser, size, async (harness) => {
        const temporaryMatchId = await queueParty(harness);
        await Promise.all(harness.members.map(acceptInUi));
        await expect(harness.leader.page.getByText(/\d+\/\d+명 수락/)).toBeVisible();
        await acceptInUi(harness.leader);
        const room = await assertSingleRoom(harness, temporaryMatchId);
        await Promise.all(harness.users.map((user) => expect(user.page).toHaveURL(new RegExp(`/room/${room.code}$`), { timeout: 15_000 })));
        expect(room.max_members).toBe(size);
        expect(room.host_id).toBe(harness.leader.id);
      });
    });

    test("일반 파티원이 마지막으로 수락해도 방이 하나만 생성된다", async ({ browser }) => {
      await withParty(browser, size, async (harness) => {
        const temporaryMatchId = await queueParty(harness);
        const lastMember = harness.members.at(-1)!;
        await acceptInUi(harness.leader);
        await Promise.all(harness.members.slice(0, -1).map(acceptInUi));
        await acceptInUi(lastMember);
        const room = await assertSingleRoom(harness, temporaryMatchId);
        await expect(lastMember.page).toHaveURL(new RegExp(`/room/${room.code}$`));
      });
    });

    test("전원이 동시에 수락해도 중복 방이 생성되지 않는다", async ({ browser }) => {
      await withParty(browser, size, async (harness) => {
        const temporaryMatchId = await queueParty(harness);
        await Promise.all(harness.users.map(acceptInUi));
        const room = await assertSingleRoom(harness, temporaryMatchId);
        await Promise.all(harness.users.map((user) => expect(user.page).toHaveURL(new RegExp(`/room/${room.code}$`), { timeout: 15_000 })));
      });
    });
  });
}

test.describe("지연·만료·거절", () => {
  test("방장이 제한시간 직전에 수락하면 5인 방이 확정된다", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const temporaryMatchId = await queueParty(harness);
      await Promise.all(harness.members.map(acceptInUi));
      await setTemporaryExpiry(temporaryMatchId, new Date(Date.now() + 8_000).toISOString());
      await harness.leader.page.waitForTimeout(5_000);
      await acceptInUi(harness.leader);
      await assertSingleRoom(harness, temporaryMatchId);
    });
  });

  test("일반 파티원이 제한시간 직전에 수락하면 10인 방이 확정된다", async ({ browser }) => {
    await withParty(browser, 10, async (harness) => {
      const temporaryMatchId = await queueParty(harness);
      const lastMember = harness.members.at(-1)!;
      await acceptInUi(harness.leader);
      await Promise.all(harness.members.slice(0, -1).map(acceptInUi));
      await setTemporaryExpiry(temporaryMatchId, new Date(Date.now() + 8_000).toISOString());
      await lastMember.page.waitForTimeout(5_000);
      await acceptInUi(lastMember);
      await assertSingleRoom(harness, temporaryMatchId);
    });
  });

  for (const lateRole of ["leader", "member"] as const) {
    test(`${lateRole === "leader" ? "방장" : "일반 파티원"}이 만료 후 수락하면 방이 생성되지 않는다`, async ({ browser }) => {
      await withParty(browser, 5, async (harness) => {
        const temporaryMatchId = await queueParty(harness);
        const lateUser = lateRole === "leader" ? harness.leader : harness.members.at(-1)!;
        await Promise.all(harness.users.filter((candidate) => candidate !== lateUser).map(acceptInUi));
        await setTemporaryExpiry(temporaryMatchId, new Date(Date.now() - 1_000).toISOString());
        const statusResponse = await lateUser.context.request.get(
          `/api/matching?since=${encodeURIComponent(harness.startedAt)}`,
        );
        expect(statusResponse.ok()).toBeTruthy();
        await lateUser.page.reload();
        await expect(lateUser.page.getByText("매칭 수락 대기 중")).not.toBeVisible({ timeout: 10_000 });
        const temp = await waitForTemporaryStatus(temporaryMatchId, "expired");
        expect(temp?.status).toBe("expired");
        expect(temp?.room_id).toBeNull();
      });
    });
  }

  for (const rejectRole of ["leader", "member"] as const) {
    test(`${rejectRole === "leader" ? "방장" : "일반 파티원"}이 거절하면 전체 임시 매칭이 취소된다`, async ({ browser }) => {
      await withParty(browser, 5, async (harness) => {
        const temporaryMatchId = await queueParty(harness);
        const rejectingUser = rejectRole === "leader" ? harness.leader : harness.members[0];
        await rejectInUi(rejectingUser);
        const temp = await waitForTemporaryStatus(temporaryMatchId, "cancelled");
        expect(temp?.status).toBe("cancelled");
        expect(temp?.room_id).toBeNull();
      });
    });
  }
});

test("매칭 방에서 나가면 기존 매칭이 다시 방으로 이동시키지 않는다", async ({ browser }) => {
  await withParty(browser, 5, async (harness) => {
    const temporaryMatchId = await queueParty(harness);
    await Promise.all(harness.users.map(acceptInUi));
    const room = await assertSingleRoom(harness, temporaryMatchId);
    const leavingUser = harness.members[0];
    await expect(leavingUser.page).toHaveURL(new RegExp(`/room/${room.code}$`), {
      timeout: 15_000,
    });

    const leaveResponse = await leavingUser.context.request.post("/api/rooms/leave", {
      data: { roomId: room.id },
    });
    expect(leaveResponse.ok()).toBeTruthy();
    await leavingUser.page.goto("/party");
    await leavingUser.page.waitForTimeout(3_000);
    await expect(leavingUser.page).toHaveURL(/\/party$/);

    const statusResponse = await leavingUser.context.request.get(
      `/api/matching?since=${encodeURIComponent(harness.startedAt)}`,
    );
    expect(statusResponse.ok()).toBeTruthy();
    await expect(statusResponse.json()).resolves.toMatchObject({ matched: false });

    const { data: participant } = await harness.admin
      .from("room_participants")
      .select("left_at")
      .eq("room_id", room.id)
      .eq("user_id", leavingUser.id)
      .order("joined_at", { ascending: false })
      .limit(1)
      .single();
    expect(participant?.left_at).not.toBeNull();
  });
});

test.describe("복구와 방 수명주기", () => {
  test("파티장이 대기 중일 때 마지막 파티원의 요청으로 즉시 잡힌 팝업도 표시된다", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const lastMember = harness.members.at(-1)!;
      for (const member of harness.members.slice(0, -1)) {
        const response = await member.context.request.post("/api/matching", {
          data: {
            role: "member",
            dungeonId: harness.dungeonId,
            characterId: member.characterId,
            stage: 3,
          },
        });
        expect(response.ok()).toBeTruthy();
      }
      const leaderResponse = await harness.leader.context.request.post("/api/matching", {
        data: {
          role: "leader",
          dungeonId: harness.dungeonId,
          characterId: harness.leader.characterId,
          stage: 3,
          minCombatPower: 700_000,
          requiredClasses: harness.members.map((member) => member.className),
        },
      });
      expect(leaderResponse.ok()).toBeTruthy();

      // APIRequest deliberately bypasses the page's immediate CustomEvent.
      // The global fallback poll must still surface the acceptance prompt.
      const lastResponse = await lastMember.context.request.post("/api/matching", {
        data: {
          role: "member",
          dungeonId: harness.dungeonId,
          characterId: lastMember.characterId,
          stage: 3,
        },
      });
      expect(lastResponse.ok()).toBeTruthy();
      await Promise.all(
        harness.users.map((user) =>
          expect(user.page.getByText("매칭 수락 대기 중")).toBeVisible({
            timeout: 5_000,
          }),
        ),
      );
      const statusResponse = await lastMember.context.request.get(
        `/api/matching?since=${encodeURIComponent(harness.startedAt)}`,
      );
      expect(statusResponse.ok()).toBeTruthy();
      const status = await statusResponse.json();
      const temporaryMatchId = status.temporaryMatch?.id as string | undefined;
      expect(temporaryMatchId).toBeTruthy();
      await Promise.all(harness.users.map(acceptInUi));
      const room = await assertSingleRoom(harness, temporaryMatchId!);
      await Promise.all(
        harness.users.map((user) =>
          expect(user.page).toHaveURL(new RegExp(`/room/${room.code}$`), {
            timeout: 15_000,
          }),
        ),
      );
    });
  });

  test("Realtime 이벤트를 놓친 사용자가 새로고침 후 확정 방을 복구한다", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const temporaryMatchId = await queueParty(harness);
      const recoveringUser = harness.members[0];
      await recoveringUser.page.goto("about:blank");
      await Promise.all(harness.users.filter((candidate) => candidate !== recoveringUser).map(acceptInUi));
      const response = await recoveringUser.context.request.patch("/api/matching", { data: { action: "accept" } });
      expect(response.ok()).toBeTruthy();
      const room = await assertSingleRoom(harness, temporaryMatchId);
      const recoveryResponse = await recoveringUser.context.request.get(
        `/api/matching?since=${encodeURIComponent(new Date().toISOString())}`,
      );
      expect(recoveryResponse.ok()).toBeTruthy();
      const recoveryStatus = await recoveryResponse.json();
      expect(recoveryStatus).toMatchObject({ matched: true, roomCode: room.code });
      await recoveringUser.page.goto("/party");
      await expect(recoveringUser.page).toHaveURL(new RegExp(`/room/${room.code}$`), { timeout: 15_000 });
    });
  });

  test("첫 입장자가 혼자 새로고침해도 매칭 방이 종료되지 않는다", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const temporaryMatchId = await queueParty(harness);
      await Promise.all(harness.users.map(acceptInUi));
      const room = await assertSingleRoom(harness, temporaryMatchId);
      await harness.leader.page.reload();
      await harness.leader.page.waitForTimeout(500);
      const { data } = await harness.admin.from("rooms").select("status").eq("id", room.id).single();
      expect(data?.status).toBe("active");
    });
  });

  test("방장이 한 명을 추방하면 같은 조건의 한 자리만 기존 방에 재매칭된다", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const temporaryMatchId = await queueParty(harness);
      await Promise.all(harness.users.map(acceptInUi));
      const room = await assertSingleRoom(harness, temporaryMatchId);
      const target = harness.members[0];
      const replacement = await createReplacementUser(harness, browser, target.className);

      await expect(harness.leader.page).toHaveURL(new RegExp(`/room/${room.code}$`), {
        timeout: 15_000,
      });
      const targetLabel = target.email.split("@")[0];
      await harness.leader.page
        .getByRole("button", { name: new RegExp(`${targetLabel}.*프로필 보기`) })
        .click();
      harness.leader.page.once("dialog", (dialog) => dialog.accept());
      await harness.leader.page
        .getByRole("button", { name: /추방.*재매칭/ })
        .click();

      await expect.poll(async () => {
        const { data: kick } = await harness.admin
          .from("room_kicks")
          .select("target_id")
          .eq("room_id", room.id)
          .eq("target_id", target.id)
          .maybeSingle();
        return kick?.target_id ?? null;
      }).toBe(target.id);

      const queueResponse = await replacement.context.request.post("/api/matching", {
        data: {
          role: "member",
          dungeonId: harness.dungeonId,
          characterId: replacement.characterId,
          stage: 3,
        },
      });
      expect(queueResponse.ok()).toBeTruthy();

      await replacement.page.goto("/party");
      await replacement.page.getByText("매칭 수락 대기 중").waitFor();
      await acceptInUi(replacement);

      await expect.poll(async () => {
        const { data } = await harness.admin
          .from("room_participants")
          .select("user_id")
          .eq("room_id", room.id)
          .is("left_at", null);
        return (data ?? []).map((participant) => participant.user_id).sort();
      }, { timeout: 15_000 }).toEqual(
        [harness.leader.id, ...harness.members.slice(1).map((member) => member.id), replacement.id].sort(),
      );

      await expect(replacement.page).toHaveURL(new RegExp(`/room/${room.code}$`), {
        timeout: 15_000,
      });
      await target.page.goto(`/room/${room.code}`);
      await expect(target.page).toHaveURL(/\/party\?error=/);
    });
  });
});
