import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postCard } from "@/lib/teams/webhook";
import type { CardEnvelope } from "@/lib/teams/types";

const envelope: CardEnvelope = {
  type: "message",
  attachments: [
    {
      contentType: "application/vnd.microsoft.card.adaptive",
      contentUrl: null,
      content: {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.4",
        body: [],
      },
    },
  ],
};

describe("postCard", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    // Make setTimeout instant so retry sleeps don't slow tests.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts envelope and resolves on 200", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, headers: new Headers() });
    await postCard("https://example.com/webhook", envelope);
    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("https://example.com/webhook");
    expect(call[1].method).toBe("POST");
    expect(call[1].headers["content-type"]).toBe("application/json");
    const body = JSON.parse(call[1].body);
    expect(body.type).toBe("message");
  });

  it("retries on 429 honoring Retry-After", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "1" }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });

    const promise = postCard("https://example.com/webhook", envelope);
    await vi.runAllTimersAsync();
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on 502", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 502, headers: new Headers() })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });

    const promise = postCard("https://example.com/webhook", envelope);
    await vi.runAllTimersAsync();
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on 400 — gives up immediately", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
      text: () => Promise.resolve("bad request"),
    });
    await expect(postCard("https://example.com/webhook", envelope)).rejects.toThrow(
      /400/,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("never includes the webhook URL in thrown error messages", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
      text: () => Promise.resolve("err"),
    });
    const secretUrl =
      "https://prod-03.westeurope.logic.azure.com/workflows/abc?sig=SECRET";
    try {
      await postCard(secretUrl, envelope);
      expect.fail("should have thrown");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).not.toContain("SECRET");
      expect(msg).not.toContain("prod-03");
    }
  });
});
