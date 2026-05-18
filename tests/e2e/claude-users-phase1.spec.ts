import { test, expect } from "@playwright/test";

/**
 * Spec 027 — Phase 1 (Commit 1) smoke E2E for the Claude Console Users tab.
 *
 * Asserts:
 *   - Admin lands on `/claude/users`, sees the tab strip, KPI strip, top-10
 *     chart, and the filterable users table.
 *   - The tab strip switches between Workspaces and Users.
 *   - Non-admin direct-nav is redirected away from the route.
 *
 * Test data is whatever happens to be in the dev DB; the assertions are
 * structural (anchors, headings, columns) rather than value-specific to keep
 * this useful as a ratchet in CI without a fixture DB.
 */

test.describe("Claude Console — Users sub-page (Phase 1)", () => {
  test.describe("admin", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/login");
      await page.fill('input[name="email"]', "admin@example.com");
      await page.fill('input[name="password"]', "admin123");
      await page.click('button[type="submit"]');
      await page.waitForURL(/\//);
    });

    test("lands on /claude/users with KPI strip, chart, and table", async ({
      page,
    }) => {
      await page.goto("/claude/users");

      // Tab strip + active "Users" link
      await expect(
        page.getByRole("navigation", { name: /Claude Console sections/i })
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Users" })).toHaveAttribute(
        "aria-current",
        "page"
      );

      // KPI strip — at least the labels are present
      for (const label of [
        "Active Users",
        "Top Spender",
        "Top-5 Concentration",
        "No API Key",
      ]) {
        await expect(page.getByText(label, { exact: true })).toBeVisible();
      }

      // Top-10 chart card + Users table card
      await expect(
        page.getByRole("heading", { name: "Top 10 Users by Cost" })
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "All Users" })
      ).toBeVisible();

      // Table columns
      for (const col of [
        "User",
        "Workspace",
        "Models",
        "Tokens",
        "Cost MTD",
        "Last active",
      ]) {
        await expect(
          page.getByRole("columnheader", { name: new RegExp(`^${col}`, "i") })
        ).toBeVisible();
      }
    });

    test("tab strip switches between Workspaces and Users", async ({ page }) => {
      await page.goto("/claude/users");
      await page.getByRole("link", { name: "Workspaces" }).click();
      await page.waitForURL("**/claude");
      await expect(page.getByRole("link", { name: "Workspaces" })).toHaveAttribute(
        "aria-current",
        "page"
      );

      await page.getByRole("link", { name: "Users" }).click();
      await page.waitForURL("**/claude/users");
      await expect(page.getByRole("link", { name: "Users" })).toHaveAttribute(
        "aria-current",
        "page"
      );
    });
  });

  test.describe("non-admin", () => {
    test("redirects away from /claude/users", async ({ page }) => {
      // Direct navigation without auth → bumped back to login (or to "/").
      await page.goto("/claude/users");
      await expect(page).not.toHaveURL(/\/claude\/users$/);
    });
  });
});
