/**
 * Browser pass over the UI write paths after the 043 core refactor.
 *
 * Every write in the app now routes through src/lib/core/* instead of living in the
 * Server Action body. The integration suite proves the cores are correct; this
 * proves the UI still reaches them — real clicks through the real dialogs, so a
 * broken Server Action wrapper, a lost revalidatePath, or a regression from the new
 * partial unique index shows up the way a user would hit it.
 *
 * Auth: mints a Nighthawk agent session via POST /api/agent/session (see the
 * agent-browser-session skill), so no human password is involved.
 *
 * Runs serially: the tests share one fixture user/tool and build on each other's
 * state (assign -> retier -> revoke), which mirrors how an admin actually works.
 */
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { config } from "dotenv";
import { Pool } from "@neondatabase/serverless";

config({ path: ".env.local" });

test.describe.configure({ mode: "serial" });

const BASE = "http://localhost:3000";
const SUFFIX = `e2e043-${Date.now()}`;
const TOOL_NAME = `E2E Tool ${SUFFIX}`;
const USER_NAME = `E2E User ${SUFFIX}`;

let pool: Pool;
let toolId: number;
let userId: number;
let userEmail: string;

async function mintSession(context: BrowserContext) {
  const secret = process.env.AGENT_SESSION_SECRET;
  if (!secret) throw new Error("AGENT_SESSION_SECRET is not set");
  const res = await context.request.post(`${BASE}/api/agent/session`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok()) throw new Error(`agent session mint failed: ${res.status()}`);
}

/** Radix Select: click the trigger, then the option by visible text. */
async function pickSelect(page: Page, placeholder: string, optionPrefix: string) {
  await page.getByRole("combobox").filter({ hasText: placeholder }).click();
  await page.getByRole("option").filter({ hasText: optionPrefix }).first().click();
}

async function activeRowCount(): Promise<number> {
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM license_assignments
     WHERE user_id = $1 AND tool_id = $2 AND status = 'active'`,
    [userId, toolId],
  );
  return r.rows[0].n;
}

test.beforeAll(async () => {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  pool = new Pool({ connectionString: url, max: 1 });

  toolId = (
    await pool.query(
      `INSERT INTO ai_tools (name, vendor) VALUES ($1, 'E2E') RETURNING id`,
      [TOOL_NAME],
    )
  ).rows[0].id;

  await pool.query(
    `INSERT INTO access_tiers (tool_id, name, monthly_cost_cents)
     VALUES ($1, 'Basic', 1000), ($1, 'Advanced', 4000)`,
    [toolId],
  );

  userEmail = `${SUFFIX}@unic.com`;
  userId = (
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, discipline)
       VALUES ($1, $2, $3, 'viewer', 'developer') RETURNING id`,
      [USER_NAME, userEmail, "x".repeat(60)],
    )
  ).rows[0].id;
});

test.afterAll(async () => {
  if (!pool) return;
  await pool.query(
    `DELETE FROM change_history WHERE entity_type = 'license_assignment'
       AND entity_id IN (SELECT id FROM license_assignments WHERE tool_id = $1)`,
    [toolId],
  );
  await pool.query(
    `DELETE FROM change_history
       WHERE (entity_type = 'ai_tool' AND entity_id = $1)
          OR (entity_type = 'access_tier'
              AND entity_id IN (SELECT id FROM access_tiers WHERE tool_id = $1))
          OR (entity_type = 'user' AND entity_id = $2)`,
    [toolId, userId],
  );
  await pool.query(`DELETE FROM license_assignments WHERE tool_id = $1`, [toolId]);
  await pool.query(`DELETE FROM access_tiers WHERE tool_id = $1`, [toolId]);
  await pool.query(`DELETE FROM ai_tools WHERE id = $1`, [toolId]);
  await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
  await pool.end();
});

test.beforeEach(async ({ context }) => {
  // There is no playwright.config in this repo, so the default 30s test timeout
  // applies. First compile of a route on `pnpm dev` can take ~17s on its own, and
  // these tests navigate several routes and wait on Server Actions.
  test.setTimeout(180_000);
  await mintSession(context);
});

test("the three write pages render without a server exception", async ({ page }) => {
  for (const path of ["/users", "/assignments", "/tools", `/tools/${toolId}`]) {
    // First compile of a route on pnpm dev can take ~17s.
    const res = await page.goto(`${BASE}${path}`, { timeout: 90_000 });
    expect(res?.status(), `${path} status`).toBeLessThan(400);
    expect(page.url(), `${path} redirected to login`).not.toContain("/login");
    // Use innerText, not textContent — textContent includes the RSC flight payload.
    const body = await page.innerText("body");
    expect(body, `${path} rendered the Next error boundary`).not.toContain(
      "Application error",
    );
  }
});

test("assigning a licence through the dialog writes an audited row", async ({
  page,
}) => {
  await page.goto(`${BASE}/assignments`, { timeout: 90_000 });

  await page.getByRole("button", { name: "Assign License" }).first().click();
  const dialog = page.getByRole("dialog");
  // Target the heading specifically — the submit button carries the same text.
  await expect(dialog.getByRole("heading", { name: "Assign License" })).toBeVisible();

  // User picker is a cmdk combobox.
  await dialog.getByRole("combobox").first().click();
  await page.getByPlaceholder("Search users...").fill(USER_NAME);
  await page.getByRole("option").filter({ hasText: USER_NAME }).first().click();

  await pickSelect(page, "Select tool", TOOL_NAME);
  await pickSelect(page, "Select tier", "Basic");

  await dialog.getByRole("button", { name: "Assign License" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // The core snapshots cost from the tier and audits with source='ui'.
  await expect
    .poll(async () => activeRowCount(), { timeout: 15_000 })
    .toBe(1);

  const row = await pool.query(
    `SELECT la.cost_at_assignment_cents AS cents, la.source, t.name AS tier
     FROM license_assignments la JOIN access_tiers t ON t.id = la.tier_id
     WHERE la.user_id=$1 AND la.tool_id=$2 AND la.status='active'`,
    [userId, toolId],
  );
  expect(row.rows[0].cents).toBe(1000);
  expect(row.rows[0].tier).toBe("Basic");
  expect(row.rows[0].source).toBe("manual");

  const audit = await pool.query(
    `SELECT ch.change_type, ch.source FROM change_history ch
     WHERE ch.entity_type='license_assignment'
       AND ch.entity_id IN (SELECT id FROM license_assignments WHERE user_id=$1 AND tool_id=$2)`,
    [userId, toolId],
  );
  expect(audit.rows.some((r) => r.change_type === "created" && r.source === "ui")).toBe(
    true,
  );

  // revalidatePath ran, so the new row is on the page after a reload.
  await page.reload({ timeout: 60_000 });
  expect(await page.innerText("body")).toContain(TOOL_NAME);
});

test("re-assigning the same user+tool at a higher tier does not trip the unique index", async ({
  page,
}) => {
  // This is the regression I was most worried about: assignLicense deactivates the
  // existing active row and inserts a new one inside ONE transaction, now against a
  // partial unique index on (user_id, tool_id) WHERE status='active'.
  //
  // Two rows is correct FOR THIS PATH. The assign dialog's deactivate-and-replace
  // is a different affordance from the assignment-detail retier, which mutates in
  // place (spec 042 — no proration, so two rows spanning the switch month would
  // both be billed). Unifying them is a product decision, not a merge one; see
  // the follow-ups in specs/043-mcp-write-tools/implementation-notes.html.
  await page.goto(`${BASE}/assignments`, { timeout: 90_000 });

  await page.getByRole("button", { name: "Assign License" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").first().click();
  await page.getByPlaceholder("Search users...").fill(USER_NAME);
  await page.getByRole("option").filter({ hasText: USER_NAME }).first().click();
  await pickSelect(page, "Select tool", TOOL_NAME);
  await pickSelect(page, "Select tier", "Advanced");
  await dialog.getByRole("button", { name: "Assign License" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // Exactly one active row survives, now at the Advanced price.
  await expect.poll(async () => activeRowCount(), { timeout: 15_000 }).toBe(1);
  const row = await pool.query(
    `SELECT la.cost_at_assignment_cents AS cents, t.name AS tier
     FROM license_assignments la JOIN access_tiers t ON t.id = la.tier_id
     WHERE la.user_id=$1 AND la.tool_id=$2 AND la.status='active'`,
    [userId, toolId],
  );
  expect(row.rows[0].cents).toBe(4000);
  expect(row.rows[0].tier).toBe("Advanced");

  const total = await pool.query(
    `SELECT count(*)::int AS n FROM license_assignments WHERE user_id=$1 AND tool_id=$2`,
    [userId, toolId],
  );
  expect(total.rows[0].n, "old row retained as inactive history").toBe(2);
});

test("changing a tier price from the tool page propagates to the held seat", async ({
  page,
}) => {
  // The spec-037 propagation, now living in setTierPriceCore and reached through
  // the tier edit dialog rather than the action body.
  await page.goto(`${BASE}/tools/${toolId}`, { timeout: 90_000 });
  const body = await page.innerText("body");
  expect(body).toContain("Advanced");

  // Tier rows are bordered divs, not table rows, so scope by the row container
  // that holds the tier name and its pencil button (sr-only label "Edit tier").
  const advancedRow = page
    .locator("div.rounded-lg.border")
    .filter({ hasText: "Advanced" })
    .first();
  await advancedRow.getByRole("button", { name: "Edit tier" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Edit Tier" })).toBeVisible();

  // The input is in DOLLARS (displayed as value/100, submitted as *100).
  const cost = dialog.getByLabel("Monthly Cost ($)");
  await expect(cost).toHaveValue("40.00");
  await cost.fill("55.00");
  await dialog.getByRole("button", { name: "Save Changes" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  await expect
    .poll(
      async () =>
        (
          await pool.query(
            `SELECT monthly_cost_cents AS c FROM access_tiers
             WHERE tool_id=$1 AND name='Advanced'`,
            [toolId],
          )
        ).rows[0].c,
      { timeout: 15_000 },
    )
    .toBe(5500);

  const seat = await pool.query(
    `SELECT cost_at_assignment_cents AS cents FROM license_assignments
     WHERE user_id=$1 AND tool_id=$2 AND status='active'`,
    [userId, toolId],
  );
  expect(seat.rows[0].cents, "active seat follows the new tier price").toBe(5500);

  const seatAudit = await pool.query(
    `SELECT count(*)::int AS n FROM change_history
     WHERE entity_type='license_assignment' AND field_name='costAtAssignmentCents'
       AND entity_id IN (SELECT id FROM license_assignments WHERE user_id=$1 AND tool_id=$2)`,
    [userId, toolId],
  );
  expect(seatAudit.rows[0].n, "per-seat reprice is audited").toBeGreaterThanOrEqual(1);
});

test("the user detail page renders history with the new source column", async ({
  page,
}) => {
  // change_history.source became NOT NULL in 0030 (DEFAULT 'ui' added by 0031); a
  // read path that does not expect it would throw here.
  const res = await page.goto(`${BASE}/users/${userId}`, { timeout: 90_000 });
  expect(res?.status()).toBeLessThan(400);
  const body = await page.innerText("body");
  expect(body).not.toContain("Application error");
  expect(body).toContain(USER_NAME);
});
