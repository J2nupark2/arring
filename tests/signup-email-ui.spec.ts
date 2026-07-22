import { expect, test } from "@playwright/test";

test("signup email confirmation UI and check-email resend UI", async ({ page }) => {
  await page.goto("/signup");
  const emailInput = page.getByRole("textbox", { name: "이메일", exact: true });
  const emailConfirmationInput = page.getByRole("textbox", { name: "이메일 확인" });
  await expect(emailInput).toBeVisible();
  await expect(emailConfirmationInput).toBeVisible();
  await emailInput.fill("wlsdn132323@gmail.com");
  await emailConfirmationInput.fill("wlsdn132323@naver.com");
  await page.getByLabel("비밀번호").fill("password1234");
  await page.getByRole("button", { name: "회원가입" }).click();
  await expect(page.getByText("이메일과 이메일 확인이 일치하지 않습니다.")).toBeVisible();

  await page.goto("/signup/check-email?email=wlsdn132323%40gmail.com");
  await expect(page.getByText("wlsdn132323@gmail.com")).toBeVisible();
  await expect(page.getByRole("button", { name: "인증 메일 다시 보내기" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "이메일을 잘못 입력했다면 다시 가입하기" }),
  ).toBeVisible();
});
