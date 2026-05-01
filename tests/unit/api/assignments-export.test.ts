import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockFindMany, mockRequireAdmin, mockDecryptApiKey } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockRequireAdmin: vi.fn(),
  mockDecryptApiKey: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      licenseAssignments: { findMany: mockFindMany },
    },
  },
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireAdmin: mockRequireAdmin,
}));

vi.mock("@/lib/crypto", () => ({
  decryptApiKey: mockDecryptApiKey,
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { GET } from "@/app/api/export/assignments/route";
import { DECRYPTION_FAILED_SENTINEL } from "@/app/api/export/assignments/constants";

// ── Test helpers ──────────────────────────────────────────────────────────────

const mockAdminUser = { id: 1, email: "admin@example.com", role: "admin" };

function makeRow(overrides: {
  id?: number;
  apiKeyEncrypted?: string | null;
  workspace?: string | null;
  assignedAt?: Date;
} = {}) {
  return {
    id: 1,
    apiKeyEncrypted: "encrypted-key-data",
    workspace: "default",
    assignedAt: new Date(2026, 0, 15),
    user: { email: "alice@example.com" },
    tool: { name: "Claude API" },
    tier: { name: "Team" },
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/export/assignments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdmin.mockResolvedValue(mockAdminUser);
    mockDecryptApiKey.mockResolvedValue("sk-ant-api03-abc123");
    mockFindMany.mockResolvedValue([makeRow()]);
  });

  describe("authorization", () => {
    it("returns 401 when user is not admin", async () => {
      mockRequireAdmin.mockResolvedValue(null);
      const response = await GET();
      expect(response.status).toBe(401);
    });
  });

  describe("successful export", () => {
    it("returns 200 with CSV content type", async () => {
      const response = await GET();
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/csv");
    });

    it("includes decrypted API key in CSV row", async () => {
      mockDecryptApiKey.mockResolvedValue("sk-ant-api03-abc123");
      const response = await GET();
      const body = await response.text();
      expect(body).toContain("sk-ant-api03-abc123");
    });

    it("renders empty string for rows without an encrypted key", async () => {
      mockFindMany.mockResolvedValue([makeRow({ apiKeyEncrypted: null })]);
      const response = await GET();
      const body = await response.text();
      expect(mockDecryptApiKey).not.toHaveBeenCalled();
      expect(body).toContain("alice@example.com,Claude API,Team,default,,2026-01-15");
    });

    it("does not set X-Decryption-Failures header when all decryptions succeed", async () => {
      const response = await GET();
      expect(response.headers.get("X-Decryption-Failures")).toBeNull();
    });

    it("returns empty CSV body with only header row when no assignments exist", async () => {
      mockFindMany.mockResolvedValue([]);
      const response = await GET();
      const body = await response.text();
      expect(body).toContain("email,tool,tier,workspace,api_key,assigned_at");
    });
  });

  describe("decryption failure handling", () => {
    it("uses DECRYPTION_FAILED sentinel instead of empty string when decryption fails", async () => {
      mockDecryptApiKey.mockRejectedValue(new Error("GCM auth tag mismatch"));
      const response = await GET();
      const body = await response.text();
      expect(body).toContain(`,${DECRYPTION_FAILED_SENTINEL},`);
    });

    it("logs error to console with assignment id when decryption fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockDecryptApiKey.mockRejectedValue(new Error("buffer too short"));
      await GET();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("assignment id=1"),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it("sets X-Decryption-Failures header with failure count", async () => {
      mockDecryptApiKey.mockRejectedValue(new Error("decryption failed"));
      const response = await GET();
      expect(response.headers.get("X-Decryption-Failures")).toBe("1");
    });

    it("counts all failed rows in X-Decryption-Failures header", async () => {
      mockFindMany.mockResolvedValue([
        makeRow({ id: 1 }),
        makeRow({ id: 2 }),
        makeRow({ id: 3, apiKeyEncrypted: null }),
      ]);
      mockDecryptApiKey.mockRejectedValue(new Error("failed"));
      const response = await GET();
      // Row 3 has no encrypted key so decryptApiKey is never called for it
      expect(response.headers.get("X-Decryption-Failures")).toBe("2");
    });

    it("still returns 200 and remaining rows when some decryptions fail", async () => {
      mockFindMany.mockResolvedValue([
        makeRow({ id: 1 }),
        makeRow({ id: 2, apiKeyEncrypted: null }),
      ]);
      mockDecryptApiKey.mockRejectedValue(new Error("failed"));
      const response = await GET();
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain(DECRYPTION_FAILED_SENTINEL);
      expect(body).toContain("alice@example.com");
    });
  });
});
