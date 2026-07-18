import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  acceptInUi,
  assertSingleRoom,
  createPartyHarness,
  createReplacementUser,
  queueParty,
  rejectInUi,
  setTemporaryExpiry,
  type PartyHarness,
  type TestUser,
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

async function expectPrompt(user: TestUser) {
  await expect(user.page.getByText("매칭 수락 대기 중")).toBeVisible();
  await expect(user.page.getByRole("button", { name: /^수락$/ })).toBeVisible();
  await expect(user.page.getByRole("button", { name: "거절" })).toBeVisible();
}

async function expectRoomScreen(page: Page, roomCode: string) {
  await expect(page).toHaveURL(new RegExp(`/room/${roomCode}$`), { timeout: 15_000 });
  await expect(
    page.getByText("매칭이 완료된 파티원만 참여하는 통화방입니다."),
  ).toBeVisible();
  await expect(page.getByText("참가자", { exact: true })).toBeVisible();
  await expect(page.getByText("채팅", { exact: true })).toBeVisible();
}

async function acceptAllAndSeeRoom(harness: PartyHarness, temporaryMatchId: string) {
  await Promise.all(harness.users.map(expectPrompt));
  await Promise.all(harness.users.map(acceptInUi));
  const room = await assertSingleRoom(harness, temporaryMatchId);
  await Promise.all(harness.users.map((user) => expectRoomScreen(user.page, room.code)));
  return room;
}

test.describe("보이는 기준 10가지", () => {
  test("방식 1 - 5인 방장이 마지막 수락", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const temporaryMatchId = await queueParty(harness);
      await Promise.all(harness.users.map(expectPrompt));
      await Promise.all(harness.members.map(acceptInUi));
      await expect(harness.leader.page.getByText("4/5명 수락")).toBeVisible();
      await acceptInUi(harness.leader);
      const room = await assertSingleRoom(harness, temporaryMatchId);
      await Promise.all(harness.users.map((user) => expectRoomScreen(user.page, room.code)));
    });
  });

  test("방식 2 - 10인 방장이 마지막 수락", async ({ browser }) => {
    await withParty(browser, 10, async (harness) => {
      const temporaryMatchId = await queueParty(harness);
      await Promise.all(harness.users.map(expectPrompt));
      await Promise.all(harness.members.map(acceptInUi));
      await expect(harness.leader.page.getByText("9/10명 수락")).toBeVisible();
      await acceptInUi(harness.leader);
      const room = await assertSingleRoom(harness, temporaryMatchId);
      await Promise.all(harness.users.map((user) => expectRoomScreen(user.page, room.code)));
    });
  });

  test("방식 3 - 5인 일반 파티원이 제한시간 직전 마지막 수락", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const temporaryMatchId = await queueParty(harness);
      const last = harness.members.at(-1)!;
      await Promise.all(harness.users.map(expectPrompt));
      await Promise.all(harness.users.filter((user) => user !== last).map(acceptInUi));
      await setTemporaryExpiry(temporaryMatchId, new Date(Date.now() + 8_000).toISOString());
      await expect(last.page.getByText("4/5명 수락")).toBeVisible();
      await last.page.waitForTimeout(5_000);
      await acceptInUi(last);
      const room = await assertSingleRoom(harness, temporaryMatchId);
      await Promise.all(harness.users.map((user) => expectRoomScreen(user.page, room.code)));
    });
  });

  test("방식 4 - 10인 일반 파티원이 제한시간 직전 마지막 수락", async ({ browser }) => {
    await withParty(browser, 10, async (harness) => {
      const temporaryMatchId = await queueParty(harness);
      const last = harness.members.at(-1)!;
      await Promise.all(harness.users.map(expectPrompt));
      await Promise.all(harness.users.filter((user) => user !== last).map(acceptInUi));
      await setTemporaryExpiry(temporaryMatchId, new Date(Date.now() + 8_000).toISOString());
      await expect(last.page.getByText("9/10명 수락")).toBeVisible();
      await last.page.waitForTimeout(5_000);
      await acceptInUi(last);
      const room = await assertSingleRoom(harness, temporaryMatchId);
      await Promise.all(harness.users.map((user) => expectRoomScreen(user.page, room.code)));
    });
  });

  test("방식 5 - 5인 전원 동시 수락", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const temporaryMatchId = await queueParty(harness);
      await acceptAllAndSeeRoom(harness, temporaryMatchId);
    });
  });

  test("방식 6 - 10인 전원 동시 수락", async ({ browser }) => {
    await withParty(browser, 10, async (harness) => {
      const temporaryMatchId = await queueParty(harness);
      await acceptAllAndSeeRoom(harness, temporaryMatchId);
    });
  });

  test("방식 7 - 방장 거절 시 전원 팝업 해제", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      await queueParty(harness);
      await Promise.all(harness.users.map(expectPrompt));
      await rejectInUi(harness.leader);
      await Promise.all(
        harness.users.map((user) =>
          expect(user.page.getByText("매칭 수락 대기 중")).not.toBeVisible({ timeout: 10_000 }),
        ),
      );
      await expect(harness.leader.page).toHaveURL(/\/party$/);
    });
  });

  test("방식 8 - 일반 파티원 거절 시 전원 팝업 해제", async ({ browser }) => {
    await withParty(browser, 10, async (harness) => {
      await queueParty(harness);
      await Promise.all(harness.users.map(expectPrompt));
      await rejectInUi(harness.members[4]);
      await Promise.all(
        harness.users.map((user) =>
          expect(user.page.getByText("매칭 수락 대기 중")).not.toBeVisible({ timeout: 10_000 }),
        ),
      );
      await expect(harness.members[4].page).toHaveURL(/\/party$/);
    });
  });

  test("방식 9 - 룸 새로고침 후 화면 유지와 실제 퇴장", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const temporaryMatchId = await queueParty(harness);
      const room = await acceptAllAndSeeRoom(harness, temporaryMatchId);
      const leavingUser = harness.members[0];
      await leavingUser.page.reload();
      await expectRoomScreen(leavingUser.page, room.code);
      await leavingUser.page.getByRole("button", { name: "퇴장" }).click();
      await expect(leavingUser.page).toHaveURL(/\/party$/, { timeout: 10_000 });
      await expect(leavingUser.page.getByText("매칭 수락 대기 중")).not.toBeVisible();
      await leavingUser.page.waitForTimeout(3_000);
      await expect(leavingUser.page).toHaveURL(/\/party$/);
    });
  });

  test("방식 10 - 방장 추방 후 동일 클래스 한 자리 재매칭", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const temporaryMatchId = await queueParty(harness);
      const room = await acceptAllAndSeeRoom(harness, temporaryMatchId);
      const target = harness.members[0];
      const replacement = await createReplacementUser(harness, browser, target.className);
      const targetLabel = target.email.split("@")[0];

      await harness.leader.page
        .getByRole("button", { name: new RegExp(`${targetLabel}.*프로필 보기`) })
        .click();
      await expect(harness.leader.page.getByText("상세 프로필", { exact: true })).toBeVisible();
      harness.leader.page.once("dialog", (dialog) => dialog.accept());
      await harness.leader.page.getByRole("button", { name: /추방.*재매칭/ }).click();
      await expect(
        harness.leader.page.getByText("빈자리 1명을 같은 조건으로 재매칭하고 있습니다."),
      ).toBeVisible();

      const response = await replacement.context.request.post("/api/matching", {
        data: {
          role: "member",
          dungeonId: harness.dungeonId,
          characterId: replacement.characterId,
          stage: 3,
        },
      });
      expect(response.ok()).toBeTruthy();
      await replacement.page.goto("/party");
      await expectPrompt(replacement);
      await acceptInUi(replacement);
      await expectRoomScreen(replacement.page, room.code);
      await expect(
        harness.leader.page.getByText("빈자리 1명을 같은 조건으로 재매칭하고 있습니다."),
      ).not.toBeVisible({ timeout: 10_000 });

      await target.page.goto(`/room/${room.code}`);
      await expect(target.page).toHaveURL(/\/party\?error=/);
      await expect(target.page.getByText(/추방된 방에는 다시 입장할 수 없습니다/)).toBeVisible();
    });
  });
});
