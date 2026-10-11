import { expect, test } from "@playwright/test";

test("the board flow keeps accessible names and focus order", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Boards" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start" })).toBeFocused();
});
