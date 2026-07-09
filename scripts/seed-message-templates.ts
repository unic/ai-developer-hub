/**
 * Seed default approval message templates per active tool (032-v2).
 *
 * This is the "one-pager follow-up" deferred in the v1 implementation notes,
 * updated for the copy-paste-snippet direction: messages are copied into Teams
 * by the approver, never posted automatically.
 *
 * Two body variants:
 *  - API-key tools (requires_api_key): includes the `{{licenseCode}}` line.
 *  - Seat tools: no key line; access is granted vendor-side before approval.
 *
 * Idempotent: a tool that already has a tool-default approval template is
 * skipped — edits made in Settings survive re-runs.
 *
 * Usage:
 *   pnpm tsx scripts/seed-message-templates.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull } from "drizzle-orm";
import { aiTools, messageTemplates } from "../src/lib/db/schema";

const SEAT_BODY = `Hi {{requester.firstName}} 👋,

Your request for **{{tool.name}}** is approved and your access is set up.

Track the request here: {{requestUrl}}

— {{approver.firstName}}`;

const API_KEY_BODY = `Hi {{requester.firstName}} 👋,

Your request for **{{tool.name}}** is approved and your access is set up.

Your API key: \`{{licenseCode}}\`
Please store it somewhere safe — treat it like a password.

Track the request here: {{requestUrl}}

— {{approver.firstName}}`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  const tools = await db.select().from(aiTools).where(eq(aiTools.status, "active"));

  for (const tool of tools) {
    const existing = await db
      .select({ id: messageTemplates.id })
      .from(messageTemplates)
      .where(
        and(
          eq(messageTemplates.toolId, tool.id),
          isNull(messageTemplates.tierId),
          eq(messageTemplates.kind, "approval"),
        ),
      );
    if (existing.length > 0) {
      console.log(`= ${tool.name}: approval default exists — skipped`);
      continue;
    }
    await db.insert(messageTemplates).values({
      toolId: tool.id,
      tierId: null,
      kind: "approval",
      bodyMd: tool.requiresApiKey ? API_KEY_BODY : SEAT_BODY,
    });
    console.log(`+ ${tool.name}: approval default seeded (${tool.requiresApiKey ? "API-key" : "seat"} variant)`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
