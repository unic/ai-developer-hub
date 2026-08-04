import { Pool, type PoolClient } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";
import { env } from "@/lib/env";

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // DATABASE_URL is Neon's POOLED (`-pooler`) endpoint — PgBouncer in
  // transaction mode, which fronts up to 10k client connections and sizes its
  // own server pool at 90% of max_connections. So this number is only how many
  // sockets ONE warm instance may open, not pressure on Postgres backends.
  //
  // It was 1, from the original design note ("max: 1 per serverless function
  // instance", specs/001 research.md) — an assumption that predates Fluid
  // Compute. Fluid reuses one instance across CONCURRENT invocations, so max:1
  // made every concurrent request on that instance queue behind a single
  // socket: the admin dashboard alone fans out 9 queries, and an hourly cron
  // holding the socket pushed page renders past connectionTimeoutMillis into
  // "timeout exceeded when trying to connect".
  max: 10,
  // Neon's proxy closes idle websockets after a few minutes without a close
  // event reaching us — the pooled socket then looks alive but fails the next
  // query (ErrorEvent, "first page load after a pause errors"). Retire idle
  // connections early so a fresh socket is dialed instead.
  idleTimeoutMillis: 30_000,
  // Headroom for a scale-to-zero compute: 10s is tight against a cold Neon
  // wake, and this timer is what turns a slow dial into a request-visible
  // failure.
  connectionTimeoutMillis: 15_000,
});

// --- Connection-fault handling -------------------------------------------
//
// Both listeners below exist to stop a dead socket from killing the whole
// process. Under Fluid Compute one instance serves many concurrent
// invocations, so a single uncaught exception takes down every in-flight
// request on it — that is the "Node.js process exited with exit status: 129"
// signature seen in production.
//
// The two cases are genuinely different objects and BOTH are needed:

// 1. IDLE clients. The driver re-emits an idle pooled client's socket error
//    onto the Pool (`pool.emit("error", err, client)`). Node throws on an
//    unhandled 'error' event, so with no listener this crashes the process.
//    Verified against @neondatabase/serverless 1.0.2: a bare
//    `pool.emit("error", new Error(...))` throws synchronously.
//    The client is already evicted by the time we are called — the next query
//    dials a fresh socket — so logging is the whole job.
pool.on("error", (err: Error) => {
  console.error("[db] idle pool client error (connection retired):", err);
});

// 2. CHECKED-OUT clients. `_acquireClient` removes the driver's own idle
//    listener on checkout, and in 1.0.2 neither `query()` nor `connect()`
//    re-attaches one — so a checked-out client has ZERO 'error' listeners.
//    While a query is in flight the error rejects that query's promise, but
//    between statements (i.e. inside a `db.transaction()`) there is nothing to
//    route it to, and the Client emits 'error' into the void → uncaught.
//    Attaching per-connect is safe: `_acquireClient` removes only its own
//    named listener by reference, so this one survives checkout/release.
pool.on("connect", (client: PoolClient) => {
  client.on("error", (err: Error) => {
    console.error("[db] checked-out client error:", err);
  });
});

export const db = drizzle(pool, { schema });
