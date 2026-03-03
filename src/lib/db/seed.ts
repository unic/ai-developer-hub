import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { hash } from "bcryptjs";
import { users } from "./schema";

async function seed() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  const passwordHash = await hash("admin123", 12);

  await db
    .insert(users)
    .values({
      name: "Admin User",
      email: "admin@company.com",
      passwordHash,
      department: "Engineering",
      role: "admin",
      status: "active",
    })
    .onConflictDoNothing({ target: users.email });

  console.log("Seed complete: admin@company.com / admin123");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
