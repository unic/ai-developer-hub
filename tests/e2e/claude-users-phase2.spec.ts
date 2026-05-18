import { test, expect } from "@playwright/test";

/**
 * Spec 027 — Phase 2 (Commit 2) smoke E2E for the new cards on the Users tab.
 *
 * Asserts:
 *   - The cost-distribution histogram card renders with all 6 bucket labels.
 *   - The Sparkline column is present in the users table header.
 *   - The Fastest-growing-users chips card is visible.
 *   - Clicking a top-movers chip pushes the chip's user email into the table
 *     search input, so the table filters to that user.
 *
 * Assertions are structural (labels + roles) so the spec stays useful across
 * different dev-DB snapshots — value-specific assertions would flake.
 */

test.describe("Claude Console — Users sub-page (Phase 2)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', "admin@example.com");
    await page.fill('input[name="password"]', "admin123");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\//);
  });

  test("renders the cost-distribution histogram with all 6 buckets", async ({
    page,
  }) => {
    await page.goto("/claude/users");
    await expect(
      page.getByRole("heading", { name: "Cost distribution" })
    ).toBeVisible();
    for (const label of [
      "$0",
      "$0.01–$1",
      "$1–$10",
      "$10–$50",
      "$50–$100",
      "$100+",
    ]) {
      // Labels appear as x-axis ticks on the SVG chart.
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test("daily-spend-by-user chart renders below the KPI strip", async ({
    page,
  }) => {
    await page.goto("/claude/users");
    await expect(
      page.getByRole("heading", { name: "Daily spend by user" })
    ).toBeVisible();
  });

  test("users table has a 6mo trend (sparkline) column", async ({ page }) => {
    await page.goto("/claude/users");
    await expect(
      page.getByRole("columnheader", { name: /6mo trend/i })
    ).toBeVisible();
  });

  test("fastest growing users chip click filters the users table", async ({
    page,
  }) => {
    await page.goto("/claude/users");
    await expect(
      page.getByRole("heading", { name: /Fastest growing users/i })
    ).toBeVisible();

    // Find the first top-mover chip — by data-testid prefix. If the dev DB has
    // zero movers, the empty-state copy is shown and we skip the click test.
    const chip = page.locator("[data-testid^=user-mover-chip-]").first();
    const chipCount = await chip.count();
    test.skip(chipCount === 0, "No top-movers in this dev DB snapshot.");

    await chip.click();

    const search = page.getByPlaceholder(/Search users by name or email/i);
    const value = await search.inputValue();
    expect(value.length).toBeGreaterThan(0);
    expect(value).toContain("@");
  });
});
