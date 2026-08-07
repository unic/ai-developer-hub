import { describe, it, expect, vi } from "vitest";

/**
 * Regression cover for the production crash signature
 * "Node.js process exited with exit status: 129".
 *
 * The Neon driver re-emits a dead socket's error onto the Pool, and strips its
 * own idle listener from any client that is checked out. With nothing listening
 * in either case, Node's unhandled-'error'-event rule turns a routine
 * connection fault into an uncaught exception — which under Fluid Compute kills
 * an instance serving many concurrent requests.
 *
 * The fake emitter below deliberately reproduces that Node semantic (an 'error'
 * emit with no listener throws), so these tests fail loudly if the handlers are
 * removed rather than silently passing on a listener count.
 */
const mocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class Emitter {
    private listeners: Record<string, Listener[]> = {};

    on(event: string, fn: Listener): this {
      (this.listeners[event] ??= []).push(fn);
      return this;
    }

    listenerCount(event: string): number {
      return this.listeners[event]?.length ?? 0;
    }

    emit(event: string, ...args: unknown[]): boolean {
      const registered = this.listeners[event];
      if (!registered || registered.length === 0) {
        // Node's EventEmitter contract: an unhandled 'error' event is thrown.
        if (event === "error") throw args[0];
        return false;
      }
      for (const fn of registered) fn(...args);
      return true;
    }
  }

  const pools: Array<Emitter & { options: Record<string, unknown> }> = [];

  class FakePool extends Emitter {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      super();
      this.options = options;
      pools.push(this);
    }
  }

  return { Emitter, FakePool, pools };
});

vi.mock("@neondatabase/serverless", () => ({ Pool: mocks.FakePool }));
vi.mock("@/lib/env", () => ({
  env: { DATABASE_URL: "postgresql://u:p@ep-test-pooler.neon.tech/db" },
}));
vi.mock("drizzle-orm/neon-serverless", () => ({ drizzle: () => ({}) }));

// Imported for the module side effects that register the handlers.
import "@/lib/db";

function thePool() {
  expect(mocks.pools).toHaveLength(1);
  return mocks.pools[0];
}

describe("db pool connection-fault handling", () => {
  it("registers a pool-level error listener", () => {
    expect(thePool().listenerCount("error")).toBeGreaterThan(0);
  });

  it("does not throw when the driver reports an idle client error", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Exactly what @neondatabase/serverless does on a dead idle socket.
    expect(() =>
      thePool().emit("error", new Error("Connection terminated unexpectedly"))
    ).not.toThrow();
    consoleSpy.mockRestore();
  });

  it("attaches an error listener to each newly connected client", () => {
    const client = new mocks.Emitter();
    thePool().emit("connect", client);
    expect(client.listenerCount("error")).toBeGreaterThan(0);
  });

  it("does not throw when a checked-out client errors between statements", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = new mocks.Emitter();
    thePool().emit("connect", client);
    // A transaction holds one client across statements; a socket death in that
    // window has no in-flight query promise to reject into.
    expect(() =>
      client.emit("error", new Error("Connection terminated unexpectedly"))
    ).not.toThrow();
    consoleSpy.mockRestore();
  });

  it("opens more than one connection so concurrent work cannot self-starve", () => {
    // max:1 made every concurrent request on a warm instance queue behind a
    // single socket, which is what produced "timeout exceeded when trying to
    // connect" on the dashboard while a cron held the connection.
    expect(thePool().options.max).toBeGreaterThan(1);
  });
});
