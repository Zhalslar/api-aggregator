const { test, expect } = require("@playwright/test");

test("open dashboard and interact with update modal", async ({ page }) => {
  await page.route("**/api/system/update/check", async (route) => {
    const payload = {
      status: "ok",
      message: "update is available",
      data: {
        status: "ready",
        progress: 0,
        message: "update is available",
        logs: [],
        check: {
          available: true,
          has_update: true,
          branch: "main",
          current_short: "abc1234",
          remote_short: "def5678",
          behind: 3,
        },
      },
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  await page.goto("/");
  await expect(page.locator("#updateIconBtn")).toBeVisible();

  await page.click("#updateIconBtn");
  await expect(page.locator("#updateModal")).toHaveClass(/open/);
  await expect(page.locator("#btnUpdateConfirm")).toBeVisible();
  await expect(page.locator("#updateModalDetail")).toContainText("main");

  await page.click("#btnUpdateCancel");
  await expect(page.locator("#updateModal")).not.toHaveClass(/open/);
});
