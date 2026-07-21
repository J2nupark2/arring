import { expect, test } from "@playwright/test";
import { createPartyHarness } from "./helpers";

test.describe("매칭 조건과 대기열", () => {
  test("5인 파티에서 인원이 한 명 부족하면 임시 매칭을 만들지 않는다", async ({ browser }) => {
    const harness = await createPartyHarness(browser, 5);
    try {
      for (const member of harness.members.slice(0, -1)) {
        const response = await member.context.request.post("/api/matching", {
          data: { role: "member", dungeonId: harness.dungeonId, characterId: member.characterId, stage: 3 },
        });
        expect(response.ok()).toBeTruthy();
      }
      const response = await harness.leader.context.request.post("/api/matching", {
        data: {
          role: "leader",
          dungeonId: harness.dungeonId,
          characterId: harness.leader.characterId,
          stage: 3,
          minCombatPower: 700_000,
          requiredClasses: [],
        },
      });
      const result = await response.json();
      expect(result.state).toBe("waiting");
      expect(result.temporaryMatch).toBeUndefined();
      expect(result.waitingCount).toBe(3);
    } finally {
      await harness.dispose();
    }
  });

  for (const mismatch of ["stage", "power", "class"] as const) {
    test(`${mismatch} 조건 불일치 사용자는 선택되지 않는다`, async ({ browser }) => {
      const harness = await createPartyHarness(browser, 5);
      try {
        for (const [index, member] of harness.members.entries()) {
          const stage = mismatch === "stage" && index === 0 ? 2 : 3;
          await member.context.request.post("/api/matching", {
            data: { role: "member", dungeonId: harness.dungeonId, characterId: member.characterId, stage },
          });
        }
        const response = await harness.leader.context.request.post("/api/matching", {
          data: {
            role: "leader",
            dungeonId: harness.dungeonId,
            characterId: harness.leader.characterId,
            stage: 3,
            minCombatPower: mismatch === "power" ? 799_500 : 700_000,
            requiredClasses: mismatch === "class" ? ["존재하지않는클래스"] : [],
          },
        });
        const result = await response.json();
        expect(response.ok()).toBeTruthy();
        expect(result.state).toBe("waiting");
        expect(result.temporaryMatch).toBeUndefined();
      } finally {
        await harness.dispose();
      }
    });
  }

  test("heartbeat가 만료된 파티원은 후보에서 제외되고 cancelled 상태가 된다", async ({ browser }) => {
    const harness = await createPartyHarness(browser, 5);
    try {
      const member = harness.members[0];
      await member.context.request.post("/api/matching", {
        data: { role: "member", dungeonId: harness.dungeonId, characterId: member.characterId, stage: 3 },
      });
      await harness.admin.from("match_queue").update({
        heartbeat_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      }).eq("user_id", member.id).eq("status", "waiting");
      const status = await member.context.request.get(`/api/matching?since=${encodeURIComponent(harness.startedAt)}`);
      const result = await status.json();
      expect(result.state).toBe("cancelled");
      expect(result.active).toBe(false);
    } finally {
      await harness.dispose();
    }
  });
});
