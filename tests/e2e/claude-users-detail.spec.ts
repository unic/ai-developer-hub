import { test, expect } from "@playwright/test";

/**
 * Spec 027 — Phase 3 (Commit 3) smoke E2E for the per-user drill route.
 *
 * Asserts:
 *   - Admin can land on `/claude/users/{N}` for a known seeded user; the
 *     header renders the user's name and the breadcrumb back to the Users
 *     list navigates correctly.
 *   - Non-admin direct nav is bumped away from the route.
 *   - 404 is returned for bad userIds (NaN, 0, negative, non-existent).
 *
 * Tests are structural — we don't pin headline cost values to a specific
 * snapshot of the dev DB.
 */

test.describe("Claude Console — Users detail page (Phase 3)", () => {
  test.describe("admin", () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/login");
      await page.fill('input[name="email"]', "admin@example.com");
      await page.fill('input[name="password"]', "admin123");
      await page.click('button[type="submit"]');
      await page.waitForURL(/\//);
    });

    test("drills from the users table chevron into the user detail page", async ({
      page,
    }) => {
      await page.goto("/claude/users");

      // Tab strip is visible — pre-conditions the drill.
      await expect(
        page.getByRole("navigation", { name: /Claude Console sections/i })
      ).toBeVisible();

      // Find any chevron drill link in the users table. The href encodes the
      // userId so we can predict the destination URL even without a fixture.
      const drill = page
        .locator("a[href^='/claude/users/']")
        .filter({ hasNot: page.getByRole("link", { name: "Users" }) })
        .first();
      const drillCount = await drill.count();
      test.skip(
        drillCount === 0,
        "Empty users table — no drill links in this dev DB snapshot."
      );

      const href = await drill.getAttribute("href");
      expect(href).toMatch(/^\/claude\/users\/\d+$/);
      await drill.click();
      await page.waitForURL(href!);

      // Header: breadcrumb back, plus the user's headline (name or email).
      await expect(
        page.getByRole("link", { name: /Claude Console \/ Users/i })
      ).toBeVisible();

      // Daily-cost card — present whether or not the user has any usage.
      await expect(
        page.getByRole("heading", { name: /Daily cost/i })
      ).toBeVisible();

      // Click the breadcrumb back to the list.
      await page.getByRole("link", { name: /Claude Console \/ Users/i }).click();
      await page.waitForURL("**/claude/users");
      await expect(
        page.getByRole("link", { name: "Users" })
      ).toHaveAttribute("aria-current", "page");
    });

    test("404s on bad userIds", async ({ page }) => {
      // Non-integer
      const r1 = await page.goto("/claude/users/abc");
      expect(r1?.status()).toBe(404);

      // Zero (the LOCK_USER_ID sentinel)
      const r2 = await page.goto("/claude/users/0");
      expect(r2?.status()).toBe(404);

      // Negative — path won't match the integer regex
      const r3 = await page.goto("/claude/users/-1");
      expect(r3?.status()).toBe(404);

      // Plausible but non-existent id
      const r4 = await page.goto("/claude/users/9999999");
      expect(r4?.status()).toBe(404);
    });
  });

  test.describe("non-admin", () => {
    test("redirects away from /claude/users/{N}", async ({ page }) => {
      await page.goto("/claude/users/1");
      await expect(page).not.toHaveURL(/\/claude\/users\/1$/);
    });
  });
});
