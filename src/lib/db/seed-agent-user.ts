import { config } from "dotenv";
config({ path: ".env.local" });

import { randomBytes } from "node:crypto";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { users } from "./schema";

async function seedAgent() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const email = (process.env.AGENT_USER_EMAIL ?? "nighthawk@agent.local").toLowerCase();

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  // Random 64-byte password that is hashed and immediately discarded.
  // No human will ever know the plaintext, and authorize() rejects isAgent rows
  // anyway — this hash exists only to satisfy the NOT NULL constraint.
  const passwordHash = await hash(randomBytes(64).toString("hex"), 12);

  const existing = await db.select({ id: users.id, isAgent: users.isAgent })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing[0]) {
    if (!existing[0].isAgent) {
      console.error(
        `Refusing to seed: a non-agent user already exists with email ${email}. ` +
          `Pick a different AGENT_USER_EMAIL or remove the conflicting row.`
      );
      await pool.end();
      process.exit(1);
    }
    console.log(`Agent user ${email} already exists (id=${existing[0].id}); nothing to do.`);
    await pool.end();
    return;
  }

  await db.insert(users).values({
    name: "Nighthawk Agent",
    email,
    passwordHash,
    role: "admin",
    discipline: "developer",
    status: "active",
    mustChangePassword: false,
    isAgent: true,
  });

  console.log(`Agent user ${email} created with role=admin, isAgent=true.`);
  await pool.end();
}

seedAgent().catch((err) => {
  console.error("Agent seed failed:", err);
  process.exit(1);
});
