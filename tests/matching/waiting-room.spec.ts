import { expect, test, type Browser } from "@playwright/test";
import { createPartyHarness, type PartyHarness } from "./helpers";

async function withParty(
  browser: Browser,
  run: (harness: PartyHarness) => Promise<void>,
) {
  const harness = await createPartyHarness(browser, 5);
  try {
    await run(harness);
  } finally {
    await harness.dispose();
  }
}

test("매칭 생성은 대기룸으로 이동하고 초대 수락한 친구도 같은 대기룸으로 이동한다", async ({
  browser,
}) => {
  await withParty(browser, async (harness) => {
    const friend = harness.members[0];
    await harness.admin.from("friend_requests").insert({
      sender_id: harness.leader.id,
      receiver_id: friend.id,
      status: "accepted",
      responded_at: new Date().toISOString(),
    });

    await harness.leader.page.goto("/party");
    await harness.leader.page.getByRole("button", { name: /매칭 생성/ }).first().click();
    await harness.leader.page.getByRole("button", { name: "매칭 생성" }).last().click();

    await expect(harness.leader.page).toHaveURL(/\/party\?matchingDraft=/);
    await expect(
      harness.leader.page.getByText("매칭 대기룸", { exact: true }),
    ).toBeVisible();
    await expect(harness.leader.page.getByRole("button", { name: "매칭 시작" })).toBeVisible();

    const leaderUrl = new URL(harness.leader.page.url());
    const draftId = leaderUrl.searchParams.get("matchingDraft");
    expect(draftId).toBeTruthy();

    const inviteResponse = await harness.leader.context.request.post("/api/matching/invites", {
      data: {
        draftId,
        receiverId: friend.id,
        dungeonId: harness.dungeonId,
        characterId: harness.leader.characterId,
        stage: 3,
        minCombatPower: 700_000,
        maxMembers: 5,
        requiredClasses: [friend.className],
      },
    });
    expect(inviteResponse.ok()).toBeTruthy();

    await friend.page.goto("/party");
    await expect(
      friend.page.getByText(`${harness.runId}-leader님의 파티`, { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await friend.page
      .getByRole("complementary")
      .getByRole("button", { name: "수락" })
      .click();

    await expect(friend.page).toHaveURL(new RegExp(`/party\\?matchingDraft=${draftId}$`));
    await expect(friend.page.getByText("매칭 대기룸", { exact: true })).toBeVisible();
    await expect(
      friend.page.getByText("초대한 파티장이 매칭을 시작할 때까지 이 화면에서 기다려주세요."),
    ).toBeVisible();
  });
});
