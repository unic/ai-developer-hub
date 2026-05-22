import { test, expect } from "@playwright/test";

test.describe("Budget Period Running Costs", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', "admin@example.com");
    await page.fill('input[name="password"]', "admin123");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\//);
  });

  test("active-budget landing shows the detail view directly", async ({ page }) => {
    // /budget now renders the detail view itself — no intermediate index card.
    await page.goto("/budget");
    await page.waitForSelector("h1");

    // The hero card + period table are both present.
    await expect(page.getByText("Period allocations & billed costs")).toBeVisible();
    await expect(page.getByText("Annual ceiling")).toBeVisible();
  });

  test("budget detail surfaces the billed YTD label", async ({ page }) => {
    await page.goto("/budget");
    await page.waitForSelector("h1");

    // The hero exposes "Billed YTD" plus an "Actual YTD" tile; either confirms the redesign rendered.
    await expect(page.getByText(/Billed YTD|Actual YTD/)).toBeVisible();
  });
});
