import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import type { ProfileData } from "@/types";

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockFindFirst, mockSyncSelectResult, mockFetchProfile, mockFetchCost } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockSyncSelectResult: vi.fn(),
  mockFetchProfile: vi.fn(),
  mockFetchCost: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: { findFirst: mockFindFirst },
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => mockSyncSelectResult(),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/profile-data", () => ({
  fetchProfileDataInternal: mockFetchProfile,
  fetchUserCostDataInternal: mockFetchCost,
}));

// ── Import after mocks ──────────────────────────────────────────────────────

import { GET } from "@/app/api/profile/route";

// ── Test helpers ─────────────────────────────────────────────────────────────

const TEST_SECRET = "test-secret-abc123";

function makeRequest(params: Record<string, string> = {}, authHeader?: string): NextRequest {
  const url = new URL("http://localhost:3000/api/profile");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const headers = new Headers();
  if (authHeader !== undefined) {
    headers.set("authorization", authHeader);
  } else {
    headers.set("authorization", `Bearer ${TEST_SECRET}`);
  }
  return new NextRequest(url, { headers });
}

const mockUser = {
  id: 1,
  name: "Jane Smith",
  email: "jane@example.com",
  role: "viewer",
  circle: "Engineering",
  profile: "boost",
  discipline: "developer",
  status: "active",
};

const mockProfileData: ProfileData = {
  user: {
    id: 1,
    name: "Jane Smith",
    email: "jane@example.com",
    role: "viewer",
    circle: "Engineering",
    profile: "boost",
    discipline: "developer",
  },
  assignments: [
    {
      id: 42,
      toolName: "Claude API",
      tierName: "Team",
      assignedAt: new Date("2026-01-15"),
      status: "active",
    },
  ],
  costData: {
    available: true,
    monthlyTotalCents: 4250,
    dailyBreakdown: [],
    latestDataDate: "2026-03-22",
    hasUnresolvedPricing: false,
  },
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("Profile API - GET /api/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PROFILE_API_SECRET", TEST_SECRET);
    mockFetchProfile.mockResolvedValue(mockProfileData);
    mockSyncSelectResult.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("parameter validation", () => {
    it("returns 400 when email param is missing", async () => {
      const response = await GET(makeRequest({}));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({
        success: false,
        error: "Missing required query parameter: email",
      });
    });

    it("returns 400 for invalid email format", async () => {
      const response = await GET(makeRequest({ email: "not-an-email" }));
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body).toEqual({ success: false, error: "Invalid email format" });
    });

    it("returns 400 for invalid month format", async () => {
      const response = await GET(
        makeRequest({ email: "jane@example.com", month: "2026-13" })
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("Invalid month format");
    });

    it("returns 400 for malformed month string", async () => {
      const response = await GET(
        makeRequest({ email: "jane@example.com", month: "March" })
      );
      expect(response.status).toBe(400);
    });
  });

  describe("user lookup", () => {
    it("returns 404 when email not found", async () => {
      mockFindFirst.mockResolvedValue(undefined);
      const response = await GET(
        makeRequest({ email: "unknown@example.com" })
      );
      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body).toEqual({ success: false, error: "Profile not found" });
    });

    it("returns 200 with full profile data for valid email", async () => {
      mockFindFirst.mockResolvedValue(mockUser);
      const response = await GET(
        makeRequest({ email: "jane@example.com" })
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.user.name).toBe("Jane Smith");
      expect(body.data.user.email).toBe("jane@example.com");
      expect(body.data.user.role).toBe("viewer");
      expect(body.data.user.circle).toBe("Engineering");
      expect(body.data.user.profile).toBe("boost");
      expect(body.data.user.status).toBe("active");
    });

    it("does not expose internal user id in response", async () => {
      mockFindFirst.mockResolvedValue(mockUser);
      const response = await GET(
        makeRequest({ email: "jane@example.com" })
      );
      const body = await response.json();
      expect(body.data.user.id).toBeUndefined();
    });
  });

  describe("assignments", () => {
    it("includes tool assignments in response", async () => {
      mockFindFirst.mockResolvedValue(mockUser);
      const response = await GET(
        makeRequest({ email: "jane@example.com" })
      );
      const body = await response.json();
      expect(body.data.assignments).toHaveLength(1);
      expect(body.data.assignments[0].toolName).toBe("Claude API");
      expect(body.data.assignments[0].tierName).toBe("Team");
    });

    it("returns empty assignments when user has none", async () => {
      mockFindFirst.mockResolvedValue(mockUser);
      mockFetchProfile.mockResolvedValue({
        ...mockProfileData,
        assignments: [],
      });
      const response = await GET(
        makeRequest({ email: "jane@example.com" })
      );
      const body = await response.json();
      expect(body.data.assignments).toEqual([]);
    });
  });

  describe("cost data", () => {
    it("includes cost data in response", async () => {
      mockFindFirst.mockResolvedValue(mockUser);
      const response = await GET(
        makeRequest({ email: "jane@example.com" })
      );
      const body = await response.json();
      expect(body.data.costData.available).toBe(true);
      expect(body.data.costData.monthlyTotalCents).toBe(4250);
      expect(body.data.costData.month).toBeDefined();
    });

    it("passes month parameter to data assembly", async () => {
      mockFindFirst.mockResolvedValue(mockUser);
      await GET(
        makeRequest({ email: "jane@example.com", month: "2026-02" })
      );
      expect(mockFetchProfile).toHaveBeenCalledWith(1, "2026-02");
    });

    it("includes month field in cost data response", async () => {
      mockFindFirst.mockResolvedValue(mockUser);
      const response = await GET(
        makeRequest({ email: "jane@example.com", month: "2026-02" })
      );
      const body = await response.json();
      expect(body.data.costData.month).toBe("2026-02");
    });

    it("includes lastSyncAt when sync status exists", async () => {
      mockFindFirst.mockResolvedValue(mockUser);
      mockSyncSelectResult.mockResolvedValue([{
        lastSyncCompletedAt: new Date("2026-03-22T14:30:00.000Z"),
      }]);
      const response = await GET(
        makeRequest({ email: "jane@example.com" })
      );
      const body = await response.json();
      expect(body.data.costData.lastSyncAt).toBe("2026-03-22T14:30:00.000Z");
    });

    it("returns lastSyncAt as null when no sync status exists", async () => {
      mockFindFirst.mockResolvedValue(mockUser);
      mockSyncSelectResult.mockResolvedValue([]);
      const response = await GET(
        makeRequest({ email: "jane@example.com" })
      );
      const body = await response.json();
      expect(body.data.costData.lastSyncAt).toBeNull();
    });
  });

  describe("error handling", () => {
    it("returns 500 for unexpected errors", async () => {
      mockFindFirst.mockRejectedValue(new Error("DB connection failed"));
      const response = await GET(
        makeRequest({ email: "jane@example.com" })
      );
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({ success: false, error: "Internal server error" });
    });
  });
});
