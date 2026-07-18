import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  acceptInUi,
  admin,
  assertSingleRoom,
  createPartyHarness,
  createReplacementUser,
  queueParty,
  rejectInUi,
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

async function waitForPrompt(user: TestUser) {
  const deadline = Date.now() + 25_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      await user.page.goto("/party");
      await expectPrompt(user);
      return;
    } catch (error) {
      lastError = error;
      await user.page.waitForTimeout(800);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("matching prompt was not visible");
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

async function leaveRoom(user: TestUser) {
  const leaveResponse = user.page.waitForResponse(
    (response) =>
      response.url().includes("/api/rooms/leave") &&
      response.request().method() === "POST",
  );
  await user.page.getByRole("button", { name: "퇴장" }).click({ force: true });
  expect((await leaveResponse).ok()).toBeTruthy();
  await expect(user.page).toHaveURL(/\/party$/, { timeout: 10_000 });
  await expect(user.page.getByText("매칭 수락 대기 중")).not.toBeVisible();
}

async function queueReplacementAndAccept(
  harness: PartyHarness,
  browser: Browser,
  className: string,
  roomCode: string,
) {
  const replacement = await createReplacementUser(harness, browser, className);
  const response = await replacement.context.request.post("/api/matching", {
    data: {
      role: "member",
      dungeonId: harness.dungeonId,
      characterId: replacement.characterId,
      stage: 3,
    },
  });
  expect(response.ok()).toBeTruthy();
  await waitForPrompt(replacement);
  await acceptInUi(replacement);
  await expectRoomScreen(replacement.page, roomCode);
  return replacement;
}

async function activeParticipantCount(roomId: string) {
  const { count, error } = await admin
    .from("room_participants")
    .select("id", { count: "exact", head: true })
    .eq("room_id", roomId)
    .is("left_at", null);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function activeRefillCount(roomId: string) {
  const { count, error } = await admin
    .from("match_requests")
    .select("id", { count: "exact", head: true })
    .eq("refill_room_id", roomId)
    .in("status", ["waiting", "processing"]);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

test.describe("보이는 기준 룸 이탈 재매칭 10가지", () => {
  test("방식 11 - 5인 파티원이 나가면 한 자리 자동 재매칭 후 입장", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const room = await acceptAllAndSeeRoom(harness, await queueParty(harness));
      const leavingUser = harness.members[0];
      await leaveRoom(leavingUser);
      await expect(
        harness.leader.page.getByText("빈자리 1명을 같은 조건으로 재매칭하고 있습니다."),
      ).toBeVisible({ timeout: 10_000 });
      await queueReplacementAndAccept(harness, browser, leavingUser.className, room.code);
      await expect(await activeParticipantCount(room.id)).toBe(5);
      await expect(
        harness.leader.page.getByText("빈자리 1명을 같은 조건으로 재매칭하고 있습니다."),
      ).not.toBeVisible({ timeout: 10_000 });
    });
  });

  test("방식 12 - 10인 파티원이 나가면 한 자리 자동 재매칭 후 입장", async ({ browser }) => {
    await withParty(browser, 10, async (harness) => {
      const room = await acceptAllAndSeeRoom(harness, await queueParty(harness));
      const leavingUser = harness.members[4];
      await leaveRoom(leavingUser);
      await expect(
        harness.leader.page.getByText("빈자리 1명을 같은 조건으로 재매칭하고 있습니다."),
      ).toBeVisible({ timeout: 10_000 });
      await queueReplacementAndAccept(harness, browser, leavingUser.className, room.code);
      await expect(await activeParticipantCount(room.id)).toBe(10);
    });
  });

  test("방식 13 - 5인 방장이 나가면 새 방장 기준으로 자동 재매칭", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const room = await acceptAllAndSeeRoom(harness, await queueParty(harness));
      const newHost = harness.members[0];
      await leaveRoom(harness.leader);
      await newHost.page.reload();
      await expectRoomScreen(newHost.page, room.code);
      await expect(
        newHost.page.getByText("빈자리 1명을 같은 조건으로 재매칭하고 있습니다."),
      ).toBeVisible({ timeout: 10_000 });
      await queueReplacementAndAccept(harness, browser, harness.leader.className, room.code);
      await expect(await activeParticipantCount(room.id)).toBe(5);
    });
  });

  test("방식 14 - 10인 방장이 나가면 새 방장 기준으로 자동 재매칭", async ({ browser }) => {
    await withParty(browser, 10, async (harness) => {
      const room = await acceptAllAndSeeRoom(harness, await queueParty(harness));
      const newHost = harness.members[0];
      await leaveRoom(harness.leader);
      await newHost.page.reload();
      await expectRoomScreen(newHost.page, room.code);
      await expect(
        newHost.page.getByText("빈자리 1명을 같은 조건으로 재매칭하고 있습니다."),
      ).toBeVisible({ timeout: 10_000 });
      await queueReplacementAndAccept(harness, browser, harness.leader.className, room.code);
      await expect(await activeParticipantCount(room.id)).toBe(10);
    });
  });

  test("방식 15 - 방장 이탈 후 새 방장이 다른 파티원을 추방하고 재매칭", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const room = await acceptAllAndSeeRoom(harness, await queueParty(harness));
      const newHost = harness.members[0];
      const target = harness.members[1];
      await leaveRoom(harness.leader);
      await queueReplacementAndAccept(harness, browser, harness.leader.className, room.code);
      await newHost.page.reload();
      await expectRoomScreen(newHost.page, room.code);
      const targetLabel = target.email.split("@")[0];
      await newHost.page
        .getByRole("button", { name: new RegExp(`${targetLabel}.*프로필 보기`) })
        .click();
      newHost.page.once("dialog", (dialog) => dialog.accept());
      await newHost.page.getByRole("button", { name: /추방.*재매칭/ }).click();
      await expect(
        newHost.page.getByText("빈자리 1명을 같은 조건으로 재매칭하고 있습니다."),
      ).toBeVisible();
      await queueReplacementAndAccept(harness, browser, target.className, room.code);
      await expect(await activeParticipantCount(room.id)).toBe(5);
    });
  });

  test("방식 16 - 파티원 이탈 후 재매칭 후보가 거절하면 팝업이 사라지고 빈자리는 유지", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const room = await acceptAllAndSeeRoom(harness, await queueParty(harness));
      const leavingUser = harness.members[0];
      await leaveRoom(leavingUser);
      const replacement = await createReplacementUser(harness, browser, leavingUser.className);
      const response = await replacement.context.request.post("/api/matching", {
        data: {
          role: "member",
          dungeonId: harness.dungeonId,
          characterId: replacement.characterId,
          stage: 3,
        },
      });
      expect(response.ok()).toBeTruthy();
      await waitForPrompt(replacement);
      await rejectInUi(replacement);
      await expect(replacement.page.getByText("매칭 수락 대기 중")).not.toBeVisible({
        timeout: 10_000,
      });
      await expect(await activeParticipantCount(room.id)).toBe(4);
    });
  });

  test("방식 17 - 두 명이 빠져도 활성 재매칭 요청은 하나만 유지", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const room = await acceptAllAndSeeRoom(harness, await queueParty(harness));
      await leaveRoom(harness.members[0]);
      await leaveRoom(harness.members[1]);
      await expect.poll(() => activeRefillCount(room.id)).toBe(1);
      await expect(await activeParticipantCount(room.id)).toBe(3);
    });
  });

  test("방식 18 - 자유 클래스 자리에서 나가면 다른 클래스도 재매칭 입장", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const room = await acceptAllAndSeeRoom(
        harness,
        await queueParty(harness, { requiredClasses: [] }),
      );
      const leavingUser = harness.members[0];
      const differentClass = harness.members.find((member) => member.className !== leavingUser.className)!;
      await leaveRoom(leavingUser);
      await queueReplacementAndAccept(harness, browser, differentClass.className, room.code);
      await expect(await activeParticipantCount(room.id)).toBe(5);
    });
  });

  test("방식 19 - 고정 클래스 자리에서 나가면 같은 클래스만 재매칭 입장", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const room = await acceptAllAndSeeRoom(harness, await queueParty(harness));
      const leavingUser = harness.members[0];
      await leaveRoom(leavingUser);
      await queueReplacementAndAccept(harness, browser, leavingUser.className, room.code);
      await expect(await activeParticipantCount(room.id)).toBe(5);
    });
  });

  test("방식 20 - 방장이 나간 뒤 다시 기존 방으로 강제 입장되지 않음", async ({ browser }) => {
    await withParty(browser, 5, async (harness) => {
      const room = await acceptAllAndSeeRoom(harness, await queueParty(harness));
      await leaveRoom(harness.leader);
      await harness.leader.page.waitForTimeout(3_000);
      await expect(harness.leader.page).toHaveURL(/\/party$/);
      await harness.leader.page.goto(`/room/${room.code}`);
      await expect(harness.leader.page).toHaveURL(/\/party\?error=/);
    });
  });
  test("방식 21 - 10명 매칭 후 추방 재매칭 중 프로필로 이동해도 강제 복귀하지 않고 후보자는 수락 팝업을 본다", async ({ browser }) => {
    await withParty(browser, 10, async (harness) => {
      const room = await acceptAllAndSeeRoom(harness, await queueParty(harness));
      const kickedUser = harness.members[4];
      const kickedLabel = kickedUser.email.split("@")[0];

      await harness.leader.page
        .getByRole("button", { name: new RegExp(`${kickedLabel}.*프로필 보기`) })
        .click();
      harness.leader.page.once("dialog", (dialog) => dialog.accept());
      await harness.leader.page.getByRole("button", { name: /추방.*재매칭/ }).click();
      await expect(
        harness.leader.page.getByText("빈자리 1명을 같은 조건으로 재매칭하고 있습니다."),
      ).toBeVisible({ timeout: 10_000 });

      await harness.leader.page.goto("/profile");
      await expect(harness.leader.page).toHaveURL(/\/profile$/, { timeout: 10_000 });
      await expect(
        harness.leader.page.getByRole("link", { name: /통화방 복귀/ }),
      ).toBeVisible({ timeout: 10_000 });
      await harness.leader.page.waitForTimeout(4_500);
      await expect(harness.leader.page).toHaveURL(/\/profile$/);

      const replacement = await createReplacementUser(harness, browser, kickedUser.className);
      const response = await replacement.context.request.post("/api/matching", {
        data: {
          role: "member",
          dungeonId: harness.dungeonId,
          characterId: replacement.characterId,
          stage: 3,
        },
      });
      expect(response.ok()).toBeTruthy();
      await waitForPrompt(replacement);
      await acceptInUi(replacement);
      await expectRoomScreen(replacement.page, room.code);
      await expect(harness.leader.page).toHaveURL(/\/profile$/);
      await expect(await activeParticipantCount(room.id)).toBe(10);
    });
  });
});
