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

test("매칭 생성 후 기존 설정 화면이 아닌 전용 대기룸으로 전환되고 초대 수락한 친구도 같은 대기룸으로 이동한다", async ({
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
    await expect(harness.leader.page.getByText("받을 클래스")).not.toBeVisible();
    await expect(harness.leader.page.getByText("초대한 친구")).not.toBeVisible();
    await harness.leader.page.getByRole("button", { name: /매칭 생성/ }).first().click();
    await expect(harness.leader.page.getByText("받을 클래스")).not.toBeVisible();
    await expect(harness.leader.page.getByText("초대한 친구")).not.toBeVisible();
    await harness.leader.page.getByRole("button", { name: "매칭 생성" }).last().click();

    await expect(harness.leader.page).toHaveURL(/\/party\?matchingDraft=/);
    await expect(
      harness.leader.page.getByText("친구를 초대하고 매칭을 시작하세요"),
    ).toBeVisible();
    await expect(
      harness.leader.page.getByText("초대 슬롯과 클래스 조건"),
    ).toBeVisible();
    await expect(harness.leader.page.getByText("초대한 친구")).toBeVisible();
    await expect(
      harness.leader.page.getByText("이 화면은 매칭 설정 화면이 아니라 초대와 준비 상태를 확인하는 전용 대기룸입니다."),
    ).toBeVisible();
    await expect(
      harness.leader.page.getByRole("button", { name: "매칭 시작" }),
    ).toBeVisible();
    await expect(
      harness.leader.page.getByRole("button", { name: "대기룸 나가기" }),
    ).toBeVisible();
    await expect(
      harness.leader.page.getByRole("button", { name: "매칭 생성" }),
    ).not.toBeVisible();
    await expect(harness.leader.page.getByText("아이온2 자동매칭")).not.toBeVisible();

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
    await expect(
      friend.page.getByText("파티장의 매칭 시작을 기다리는 중"),
    ).toBeVisible();
    await expect(friend.page.getByText("대기룸 입장 완료")).toBeVisible();
    await expect(
      friend.page.getByText("파티장이 매칭을 시작하면 매칭 수락 대기 팝업이 표시됩니다. 이 화면을 유지한 채 기다려주세요."),
    ).toBeVisible();
    await expect(
      friend.page.getByRole("button", { name: "매칭 생성" }),
    ).not.toBeVisible();
    await expect(friend.page.getByText("아이온2 자동매칭")).not.toBeVisible();
  });
});
