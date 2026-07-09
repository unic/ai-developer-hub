import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";
import { env } from "@/lib/env";

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 1,
  // Neon's proxy closes idle websockets after a few minutes without a close
  // event reaching us — the pooled socket then looks alive but fails the next
  // query (ErrorEvent, "first page load after a pause errors"). Retire idle
  // connections early so a fresh socket is dialed instead.
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export const db = drizzle(pool, { schema });
