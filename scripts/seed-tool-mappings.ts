/**
 * Seed for the 032-v2 tool_mappings table — the AI Tooling Guide rules
 * (https://unicag.sharepoint.com/sites/M-AIIMPACT/SitePages/AI-Tooling-Guide.aspx,
 * read 2026-07-09):
 *
 *   developer  + baseline → GitHub Copilot · Business
 *   conception + baseline → Microsoft Copilot · Standard
 *   business   + baseline → Microsoft Copilot · Standard
 *   any        + maxed    → Claude · Standard Seat
 *   any        + indie    → (needs decision — no tool)
 *
 * Also flags Claude Console as requires_api_key (assignments carry a key).
 *
 * Idempotent: existing (role, profile) rows are left untouched — edits made in
 * Settings survive re-runs. Tools/tiers are resolved by name; missing ones are
 * warned about and skipped.
 *
 * Usage:
 *   pnpm tsx scripts/seed-tool-mappings.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull } from "drizzle-orm";
import { aiTools, accessTiers, toolMappings } from "../src/lib/db/schema";

type SeedRow = {
  role: "developer" | "conception" | "business" | null;
  profile: "baseline" | "maxed" | "indie";
  toolName: string | null;
  tierName: string | null;
};

const SEED: SeedRow[] = [
  { role: "developer", profile: "baseline", toolName: "GitHub Copilot", tierName: "Business" },
  { role: "conception", profile: "baseline", toolName: "Microsoft Copilot", tierName: "Standard" },
  { role: "business", profile: "baseline", toolName: "Microsoft Copilot", tierName: "Standard" },
  { role: null, profile: "maxed", toolName: "Claude", tierName: "Standard Seat" },
  { role: null, profile: "indie", toolName: null, tierName: null },
];

const REQUIRES_API_KEY_TOOLS = ["Claude Console"];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  const tools = await db.select().from(aiTools);
  const tiers = await db.select().from(accessTiers);
  const toolByName = new Map(tools.map((t) => [t.name.toLowerCase(), t]));

  for (const row of SEED) {
    const existing = await db
      .select({ id: toolMappings.id })
      .from(toolMappings)
      .where(
        and(
          row.role === null
            ? isNull(toolMappings.role)
            : eq(toolMappings.role, row.role),
          eq(toolMappings.profile, row.profile),
        ),
      );
    if (existing.length > 0) {
      console.log(`= (${row.role ?? "any"}, ${row.profile}) exists — skipped`);
      continue;
    }

    let toolId: number | null = null;
    let defaultTierId: number | null = null;
    if (row.toolName) {
      const tool = toolByName.get(row.toolName.toLowerCase());
      if (!tool) {
        console.warn(`! tool "${row.toolName}" not found — skipping (${row.role ?? "any"}, ${row.profile})`);
        continue;
      }
      toolId = tool.id;
      if (row.tierName) {
        const tier = tiers.find(
          (t) => t.toolId === tool.id && t.name.toLowerCase() === row.tierName!.toLowerCase(),
        );
        if (!tier) {
          console.warn(`! tier "${row.tierName}" not found on ${row.toolName} — mapping seeded without default tier`);
        } else {
          defaultTierId = tier.id;
        }
      }
    }

    await db.insert(toolMappings).values({ role: row.role, profile: row.profile, toolId, defaultTierId });
    console.log(`+ (${row.role ?? "any"}, ${row.profile}) → ${row.toolName ?? "needs decision"}${defaultTierId ? ` · ${row.tierName}` : ""}`);
  }

  for (const name of REQUIRES_API_KEY_TOOLS) {
    const tool = toolByName.get(name.toLowerCase());
    if (!tool) {
      console.warn(`! tool "${name}" not found — requires_api_key not set`);
      continue;
    }
    if (!tool.requiresApiKey) {
      await db.update(aiTools).set({ requiresApiKey: true }).where(eq(aiTools.id, tool.id));
      console.log(`+ ${name}: requires_api_key = true`);
    } else {
      console.log(`= ${name}: requires_api_key already true`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
