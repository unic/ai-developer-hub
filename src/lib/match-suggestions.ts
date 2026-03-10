import { compareTwoStrings } from "string-similarity";
import type { MatchSuggestion, SyncUnmatchedMember, SyncUnmatchedSystemUser } from "@/types";

/**
 * Compute match suggestions for an unmatched GitHub member against a list of system users.
 * Returns top 3 suggestions sorted by score descending. Inactive users sort lower at equal scores.
 */
export function computeMatchSuggestions(
  unmatchedMember: SyncUnmatchedMember,
  systemUsers: SyncUnmatchedSystemUser[]
): MatchSuggestion[] {
  const suggestions: MatchSuggestion[] = [];

  for (const user of systemUsers) {
    let score = 0;
    let reason = "";

    // Name similarity scoring
    const githubName = unmatchedMember.githubName?.toLowerCase() ?? "";
    const userName = user.userName.toLowerCase();

    if (githubName && userName) {
      const nameScore = compareTwoStrings(githubName, userName);
      if (nameScore > score) {
        score = nameScore;
        reason = "Name similarity";
      }
    }

    // Also compare GitHub login to user name
    const loginScore = compareTwoStrings(unmatchedMember.githubLogin.toLowerCase(), userName);
    if (loginScore > score) {
      score = loginScore;
      reason = "Username similarity";
    }

    // Email domain matching
    const githubEmail = unmatchedMember.githubEmail?.toLowerCase() ?? "";
    const userEmail = user.userEmail.toLowerCase();

    if (githubEmail && userEmail) {
      const githubDomain = githubEmail.split("@")[1];
      const userDomain = userEmail.split("@")[1];

      if (githubDomain && userDomain && githubDomain === userDomain) {
        // Domain match gives a boost
        const emailScore = compareTwoStrings(githubEmail, userEmail);
        if (emailScore > score) {
          score = emailScore;
          reason = "Email match";
        } else if (score > 0) {
          // Boost existing score if domains match
          score = Math.min(1, score + 0.1);
          reason = `${reason} + email domain`;
        } else {
          score = 0.3;
          reason = "Email domain match";
        }
      }
    }

    // Only include if there's some similarity
    if (score > 0.1) {
      suggestions.push({
        userId: user.userId,
        userName: user.userName,
        userEmail: user.userEmail,
        userStatus: user.userStatus ?? "active",
        githubUsername: user.githubUsername,
        score,
        reason,
      });
    }
  }

  // Sort by score descending, then by active status (active first at equal scores)
  suggestions.sort((a, b) => {
    if (Math.abs(a.score - b.score) < 0.001) {
      // Equal scores: active users first
      if (a.userStatus === "active" && b.userStatus === "inactive") return -1;
      if (a.userStatus === "inactive" && b.userStatus === "active") return 1;
      return 0;
    }
    return b.score - a.score;
  });

  // Return top 3
  return suggestions.slice(0, 3);
}
