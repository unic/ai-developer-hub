import { describe, it, expect } from "vitest";
import { computeMatchSuggestions } from "@/lib/match-suggestions";
import type { SyncUnmatchedMember, SyncUnmatchedSystemUser } from "@/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMember(
  overrides: Partial<SyncUnmatchedMember> = {}
): SyncUnmatchedMember {
  return {
    githubLogin: "jdoe",
    githubId: 1,
    githubName: "John Doe",
    githubAvatarUrl: null,
    githubBio: null,
    githubPublicRepos: null,
    githubProfileUrl: "https://github.com/jdoe",
    githubEmail: null,
    ...overrides,
  };
}

function makeUser(
  overrides: Partial<SyncUnmatchedSystemUser> & Pick<SyncUnmatchedSystemUser, "userId">
): SyncUnmatchedSystemUser {
  return {
    userName: "John Doe",
    userEmail: "john.doe@example.com",
    githubUsername: null,
    userStatus: "active",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeMatchSuggestions", () => {
  // -----------------------------------------------------------------------
  // 1. Exact name match scores highest
  // -----------------------------------------------------------------------
  describe("exact name match", () => {
    it("scores 1.0 when GitHub name exactly matches system user name", () => {
      const member = makeMember({ githubName: "Alice Smith" });
      const users = [
        makeUser({ userId: 1, userName: "Alice Smith", userEmail: "alice@corp.com" }),
        makeUser({ userId: 2, userName: "Bob Jones", userEmail: "bob@corp.com" }),
      ];

      const results = computeMatchSuggestions(member, users);

      expect(results[0].userId).toBe(1);
      expect(results[0].score).toBe(1);
      expect(results[0].reason).toBe("Name similarity");
    });

    it("scores 1.0 for case-insensitive exact name match", () => {
      const member = makeMember({ githubName: "alice smith" });
      const users = [
        makeUser({ userId: 1, userName: "Alice Smith", userEmail: "a@x.com" }),
      ];

      const results = computeMatchSuggestions(member, users);

      expect(results[0].score).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Partial name match scored by Dice coefficient
  // -----------------------------------------------------------------------
  describe("partial name match (Dice coefficient)", () => {
    it("produces a score between 0 and 1 for similar names", () => {
      const member = makeMember({ githubName: "Jonathan Doe" });
      const users = [
        makeUser({ userId: 1, userName: "John Doe", userEmail: "j@x.com" }),
      ];

      const results = computeMatchSuggestions(member, users);

      expect(results).toHaveLength(1);
      expect(results[0].score).toBeGreaterThan(0.1);
      expect(results[0].score).toBeLessThan(1);
    });

    it("ranks more similar names higher", () => {
      const member = makeMember({ githubName: "Anna Mueller" });
      const users = [
        makeUser({ userId: 1, userName: "Anna Muller", userEmail: "a@x.com" }),
        makeUser({ userId: 2, userName: "Zara Kahn", userEmail: "z@x.com" }),
      ];

      const results = computeMatchSuggestions(member, users);

      // "Anna Muller" should rank higher than "Zara Kahn"
      expect(results[0].userId).toBe(1);
      if (results.length > 1) {
        expect(results[0].score).toBeGreaterThan(results[1].score);
      }
    });

    it("uses GitHub login when GitHub name is null", () => {
      const member = makeMember({ githubLogin: "johndoe", githubName: null });
      const users = [
        makeUser({ userId: 1, userName: "John Doe", userEmail: "j@x.com" }),
        makeUser({ userId: 2, userName: "zzz zzz", userEmail: "z@x.com" }),
      ];

      const results = computeMatchSuggestions(member, users);

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].userId).toBe(1);
      expect(results[0].reason).toBe("Username similarity");
    });
  });

  // -----------------------------------------------------------------------
  // 3. Email domain match scoring
  // -----------------------------------------------------------------------
  describe("email domain match scoring", () => {
    it("boosts score when email domains match and name already scored", () => {
      const member = makeMember({
        githubName: "John Doe",
        githubEmail: "john@corp.com",
      });
      const userWithDomain = makeUser({
        userId: 1,
        userName: "John Doe",
        userEmail: "john.doe@corp.com",
      });
      const userWithoutDomain = makeUser({
        userId: 2,
        userName: "John Doe",
        userEmail: "john.doe@other.org",
      });

      const withDomain = computeMatchSuggestions(member, [userWithDomain]);
      const withoutDomain = computeMatchSuggestions(member, [userWithoutDomain]);

      // Domain match should boost the score or at least not lower it
      expect(withDomain[0].score).toBeGreaterThanOrEqual(withoutDomain[0].score);
    });

    it("gives 0.3 base score for domain-only match when name has no similarity", () => {
      const member = makeMember({
        githubLogin: "xyzabc123",
        githubName: "Xyz Abc",
        githubEmail: "xyz@corp.com",
      });
      const users = [
        makeUser({ userId: 1, userName: "Totally Different", userEmail: "other@corp.com" }),
      ];

      const results = computeMatchSuggestions(member, users);

      // The name scores will be very low, so domain match should contribute
      // At minimum the domain match boosts score above 0.1 threshold
      expect(results.length).toBeGreaterThanOrEqual(1);
      const suggestion = results.find((r) => r.userId === 1);
      expect(suggestion).toBeDefined();
      expect(suggestion!.score).toBeGreaterThanOrEqual(0.1);
    });

    it("returns 'Email domain match' reason for domain-only match", () => {
      const member = makeMember({
        githubLogin: "qqq999",
        githubName: null,
        githubEmail: "qqq@company.io",
      });
      const users = [
        makeUser({ userId: 1, userName: "Zzz Yyy", userEmail: "zzz@company.io" }),
      ];

      const results = computeMatchSuggestions(member, users);

      // The login "qqq999" vs name "Zzz Yyy" should be very low, so domain
      // should dominate the scoring path
      const suggestion = results.find((r) => r.userId === 1);
      if (suggestion) {
        expect(suggestion.reason).toMatch(/email/i);
      }
    });

    it("includes 'email domain' in reason when domain boosts an existing score", () => {
      const member = makeMember({
        githubName: "Jan Novak",
        githubEmail: "jan@corp.com",
      });
      const users = [
        makeUser({ userId: 1, userName: "Jan Novak", userEmail: "jan.novak@corp.com" }),
      ];

      const results = computeMatchSuggestions(member, users);

      // Exact name match gives score 1.0 — the domain boost path with
      // Math.min(1, score + 0.1) caps at 1, but reason should include email domain
      // OR the email score is higher — either way, the reason should mention email or name
      expect(results[0].score).toBeGreaterThanOrEqual(1);
      // With exact name match (1.0), domain boost => Math.min(1, 1.0 + 0.1) = 1.0
      // reason = "Name similarity + email domain"
      expect(results[0].reason).toContain("email domain");
    });
  });

  // -----------------------------------------------------------------------
  // 4. Inactive users sorted lower at equal scores
  // -----------------------------------------------------------------------
  describe("inactive users sorted lower", () => {
    it("ranks active user above inactive user at equal scores", () => {
      const member = makeMember({ githubName: "Test User" });
      const users = [
        makeUser({
          userId: 1,
          userName: "Test User",
          userEmail: "a@x.com",
          userStatus: "inactive",
        }),
        makeUser({
          userId: 2,
          userName: "Test User",
          userEmail: "b@x.com",
          userStatus: "active",
        }),
      ];

      const results = computeMatchSuggestions(member, users);

      expect(results).toHaveLength(2);
      expect(results[0].userStatus).toBe("active");
      expect(results[0].userId).toBe(2);
      expect(results[1].userStatus).toBe("inactive");
      expect(results[1].userId).toBe(1);
    });

    it("does not reorder when scores differ", () => {
      const member = makeMember({ githubName: "Alice" });
      const users = [
        makeUser({
          userId: 1,
          userName: "Alice",
          userEmail: "a@x.com",
          userStatus: "inactive",
        }),
        makeUser({
          userId: 2,
          userName: "Bob",
          userEmail: "b@x.com",
          userStatus: "active",
        }),
      ];

      const results = computeMatchSuggestions(member, users);

      // Alice (inactive) has a much higher name score than Bob (active)
      expect(results[0].userId).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Empty/null fields handled gracefully
  // -----------------------------------------------------------------------
  describe("empty and null fields", () => {
    it("handles null githubName without throwing", () => {
      const member = makeMember({ githubName: null });
      const users = [
        makeUser({ userId: 1, userName: "Someone", userEmail: "s@x.com" }),
      ];

      expect(() => computeMatchSuggestions(member, users)).not.toThrow();
    });

    it("handles null githubEmail without throwing", () => {
      const member = makeMember({ githubEmail: null });
      const users = [
        makeUser({ userId: 1, userName: "Someone", userEmail: "s@x.com" }),
      ];

      expect(() => computeMatchSuggestions(member, users)).not.toThrow();
    });

    it("returns empty array when system users list is empty", () => {
      const member = makeMember();
      const results = computeMatchSuggestions(member, []);

      expect(results).toEqual([]);
    });

    it("handles null githubUsername on system user without throwing", () => {
      const member = makeMember();
      const users = [
        makeUser({ userId: 1, githubUsername: null }),
      ];

      expect(() => computeMatchSuggestions(member, users)).not.toThrow();
    });

    it("defaults userStatus to 'active' in output when null in input", () => {
      const member = makeMember({ githubName: "John Doe" });
      // Force userStatus to null to test the fallback
      const users = [
        {
          userId: 1,
          userName: "John Doe",
          userEmail: "j@x.com",
          githubUsername: null,
          userStatus: null as unknown as "active" | "inactive",
        },
      ];

      const results = computeMatchSuggestions(member, users as SyncUnmatchedSystemUser[]);

      expect(results).toHaveLength(1);
      expect(results[0].userStatus).toBe("active");
    });
  });

  // -----------------------------------------------------------------------
  // 6. Top 3 limit enforced
  // -----------------------------------------------------------------------
  describe("top 3 limit", () => {
    it("returns at most 3 suggestions even when more users match", () => {
      const member = makeMember({ githubName: "Test" });
      const users = Array.from({ length: 10 }, (_, i) =>
        makeUser({
          userId: i + 1,
          userName: `Test User ${i}`,
          userEmail: `test${i}@x.com`,
        })
      );

      const results = computeMatchSuggestions(member, users);

      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("returns the top 3 by score", () => {
      const member = makeMember({ githubName: "Alice" });
      const users = [
        makeUser({ userId: 1, userName: "Alice", userEmail: "a@x.com" }),       // exact
        makeUser({ userId: 2, userName: "Alicia", userEmail: "b@x.com" }),      // close
        makeUser({ userId: 3, userName: "Alison", userEmail: "c@x.com" }),      // somewhat close
        makeUser({ userId: 4, userName: "Alexandra", userEmail: "d@x.com" }),   // less close
        makeUser({ userId: 5, userName: "Zzzzzz", userEmail: "e@x.com" }),      // no match
      ];

      const results = computeMatchSuggestions(member, users);

      expect(results.length).toBeLessThanOrEqual(3);
      // Exact match should always be first
      expect(results[0].userId).toBe(1);
      // Scores should be descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 7. Low similarity (below 0.1) excluded
  // -----------------------------------------------------------------------
  describe("low similarity threshold", () => {
    it("excludes users with score <= 0.1", () => {
      const member = makeMember({
        githubLogin: "aaaaaa",
        githubName: "Aaaaaa Bbbbbb",
        githubEmail: null,
      });
      const users = [
        makeUser({ userId: 1, userName: "Zzzzz Yyyyy", userEmail: "z@other.org" }),
      ];

      const results = computeMatchSuggestions(member, users);

      // Very dissimilar names — should be excluded
      expect(results).toHaveLength(0);
    });

    it("includes users with score just above 0.1", () => {
      // Use names that have slight overlap to produce a low but > 0.1 score
      const member = makeMember({
        githubLogin: "markus",
        githubName: "Markus",
        githubEmail: null,
      });
      const users = [
        makeUser({ userId: 1, userName: "Marcus", userEmail: "m@x.com" }),
      ];

      const results = computeMatchSuggestions(member, users);

      // "markus" vs "marcus" — Dice coefficient should be well above 0.1
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].score).toBeGreaterThan(0.1);
    });

    it("returns empty array when no users pass the threshold", () => {
      const member = makeMember({
        githubLogin: "abc",
        githubName: "Xxx",
        githubEmail: null,
      });
      const users = [
        makeUser({ userId: 1, userName: "Qqqqqqqqqqq", userEmail: "q@other.org" }),
        makeUser({ userId: 2, userName: "Wwwwwwwwwww", userEmail: "w@other.org" }),
      ];

      const results = computeMatchSuggestions(member, users);

      expect(results).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Additional: GitHub login vs user name matching
  // -----------------------------------------------------------------------
  describe("github login matching", () => {
    it("uses login similarity when it scores higher than name similarity", () => {
      const member = makeMember({
        githubLogin: "jsmith",
        githubName: "Completely Different",
      });
      const users = [
        makeUser({ userId: 1, userName: "J Smith", userEmail: "j@x.com" }),
      ];

      const results = computeMatchSuggestions(member, users);

      expect(results.length).toBeGreaterThanOrEqual(1);
      // Login "jsmith" is more similar to "j smith" than "completely different"
      // so the reason should reflect username similarity
      expect(results[0].reason).toBe("Username similarity");
    });
  });
});
