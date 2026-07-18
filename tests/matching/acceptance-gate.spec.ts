import { expect, test, type Browser } from "@playwright/test";
import {
  acceptInUi,
  assertSingleRoom,
  createPartyHarness,
  queueParty,
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

async function expectAcceptancePromptWithoutCounts(harness: PartyHarness) {
  for (const user of harness.users) {
    await expect(user.page.getByText("매칭 수락 대기 중")).toBeVisible();
    await expect(user.page.getByText(/초 남음/)).toBeVisible();
    await expect(user.page.getByText(/\d+\/\d+명 수락/)).not.toBeVisible();
  }
}

async function expectEveryScreenEnteredFullRoom(
  harness: PartyHarness,
  roomCode: string,
  size: 5 | 10,
) {
  await Promise.all(
    harness.users.map(async (user) => {
      await expect(user.page).toHaveURL(new RegExp(`/room/${roomCode}$`), {
        timeout: 15_000,
      });
      await expect(user.page.getByText(`${size}/${size}명`, { exact: true })).toBeVisible();
      for (let count = 1; count < size; count += 1) {
        await expect(
          user.page.getByText(`${count}/${size}명`, { exact: true }),
        ).not.toBeVisible();
      }
    }),
  );
}

for (const size of [5, 10] as const) {
  test(`${size}인 마지막 수락 응답은 방 URL을 직접 주지 않고 백엔드 전원 입장 후 화면 전환된다`, async ({
    browser,
  }) => {
    await withParty(browser, size, async (harness) => {
      const temporaryMatchId = await queueParty(harness);
      await expectAcceptancePromptWithoutCounts(harness);

      await Promise.all(harness.members.map(acceptInUi));
      await expect(harness.leader.page.getByText("매칭 수락 대기 중")).toBeVisible();
      await expect(harness.leader.page.getByText(/초 남음/)).toBeVisible();
      await expect(harness.leader.page.getByText(/\d+\/\d+명 수락/)).not.toBeVisible();

      const lastAccept = await harness.leader.context.request.patch("/api/matching", {
        data: { action: "accept" },
      });
      expect(lastAccept.ok()).toBeTruthy();
      const lastAcceptBody = (await lastAccept.json()) as {
        matched?: boolean;
        roomCode?: string;
        active?: boolean;
        state?: string;
      };

      expect(lastAcceptBody.matched).toBe(false);
      expect(lastAcceptBody.roomCode).toBeUndefined();
      expect(lastAcceptBody.active).toBe(true);
      expect(lastAcceptBody.state).toBe("processing");

      const room = await assertSingleRoom(harness, temporaryMatchId);
      const { count: activeParticipantsBeforeTransition, error: participantCountError } =
        await harness.admin
          .from("room_participants")
          .select("id", { count: "exact", head: true })
          .eq("room_id", room.id)
          .is("left_at", null);
      expect(participantCountError).toBeNull();
      expect(activeParticipantsBeforeTransition).toBe(size);

      const statusAfterFinalization = await harness.leader.context.request.get(
        `/api/matching?since=${encodeURIComponent(harness.startedAt)}`,
      );
      expect(statusAfterFinalization.ok()).toBeTruthy();
      await expect(statusAfterFinalization.json()).resolves.toMatchObject({
        matched: true,
        roomCode: room.code,
      });

      if (!new RegExp(`/room/${room.code}$`).test(harness.leader.page.url())) {
        await harness.leader.page.goto("/party").catch((error: unknown) => {
          if (
            !(error instanceof Error) ||
            !error.message.includes("net::ERR_ABORTED")
          ) {
            throw error;
          }
        });
      }
      await expect(harness.leader.page).toHaveURL(new RegExp(`/room/${room.code}$`), {
        timeout: 15_000,
      });
      await expectEveryScreenEnteredFullRoom(harness, room.code, size);
    });
  });
}

test("수락 인원 수는 방장 마지막/파티원 마지막/동시 수락 직전 모든 화면에서 숨겨진다", async ({
  browser,
}) => {
  await withParty(browser, 5, async (harness) => {
    const temporaryMatchId = await queueParty(harness);
    await expectAcceptancePromptWithoutCounts(harness);

    await acceptInUi(harness.leader);
    await expectAcceptancePromptWithoutCounts({
      ...harness,
      users: harness.members,
    });

    await Promise.all(harness.members.slice(0, -1).map(acceptInUi));
    const lastMember = harness.members.at(-1)!;
    await expect(lastMember.page.getByText("매칭 수락 대기 중")).toBeVisible();
    await expect(lastMember.page.getByText(/초 남음/)).toBeVisible();
    await expect(lastMember.page.getByText(/\d+\/\d+명 수락/)).not.toBeVisible();

    await acceptInUi(lastMember);
    const room = await assertSingleRoom(harness, temporaryMatchId);
    await Promise.all(
      harness.users.map((user) =>
        expect(user.page).toHaveURL(new RegExp(`/room/${room.code}$`), {
          timeout: 15_000,
        }),
      ),
    );
  });
});
