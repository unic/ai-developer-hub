import { test, expect } from "@playwright/test";

test.describe("Sync Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', "admin@example.com");
    await page.fill('input[name="password"]', "admin123");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\//);
  });

  test("shows all 6 sync sources", async ({ page }) => {
    await page.goto("/settings/sync");
    await page.waitForSelector("table");

    const rows = page.locator("table tbody tr");
    await expect(rows).toHaveCount(6);

    const sourceNames = [
      "GitHub Copilot Billing",
      "Anthropic API Usage",
      "Claude Team Invoices",
      "GitHub Members",
      "Invoice-Period Matching",
      "Anthropic Workspace Sync",
    ];

    for (const name of sourceNames) {
      await expect(page.getByText(name)).toBeVisible();
    }
  });

  test("shows Never synced for sources without events", async ({ page }) => {
    await page.goto("/settings/sync");
    await page.waitForSelector("table");
    const neverSynced = page.getByText("Never synced");
    await expect(neverSynced.first()).toBeVisible();
  });

  test("each row has schedule and status columns", async ({ page }) => {
    await page.goto("/settings/sync");
    await page.waitForSelector("table");
    await expect(page.getByRole("columnheader", { name: "Schedule" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Source" })).toBeVisible();
  });
});
