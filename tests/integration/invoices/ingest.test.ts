import { describe, it } from "vitest";

describe("POST /api/invoices/ingest", () => {
  // These tests require a running server and DB
  it.todo("returns 401 with no auth header");
  it.todo("returns 400 when no PDF provided");
  it.todo("returns 200 with valid PDF and correct Bearer token");
  it.todo("returns 409 when submitting same invoice twice");
});
