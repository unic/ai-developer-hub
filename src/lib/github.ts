import type {
  GitHubMemberData,
  SyncMatchedMember,
  SyncUnmatchedMember,
  SyncConflict,
} from "@/types";

const GITHUB_API_BASE = "https://api.github.com";

interface GitHubApiResponse<T> {
  data: T | null;
  error: string | null;
  scopes: string[];
  rateLimitRemaining: number;
  rateLimitReset: number;
}

function parseHeaders(headers: Headers) {
  const scopes = (headers.get("x-oauth-scopes") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const rateLimitRemaining = parseInt(
    headers.get("x-ratelimit-remaining") || "0",
    10
  );
  const rateLimitReset = parseInt(
    headers.get("x-ratelimit-reset") || "0",
    10
  );
  return { scopes, rateLimitRemaining, rateLimitReset };
}

async function githubFetch<T>(
  path: string,
  token: string,
  params?: Record<string, string>
): Promise<GitHubApiResponse<T>> {
  const url = new URL(`${GITHUB_API_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    cache: "no-store",
  });

  const { scopes, rateLimitRemaining, rateLimitReset } = parseHeaders(
    response.headers
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message =
      (body as { message?: string }).message ||
      `GitHub API error: ${response.status}`;
    return {
      data: null,
      error: message,
      scopes,
      rateLimitRemaining,
      rateLimitReset,
    };
  }

  const data = (await response.json()) as T;
  return { data, error: null, scopes, rateLimitRemaining, rateLimitReset };
}

// Types for GitHub API responses
interface GitHubOrg {
  login: string;
  id: number;
  avatar_url: string;
  description: string | null;
}

interface GitHubOrgMember {
  login: string;
  id: number;
  avatar_url: string;
}

interface GitHubUserProfile {
  login: string;
  id: number;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  bio: string | null;
  public_repos: number;
  html_url: string;
}

export async function validateTokenAndListOrgs(token: string) {
  const result = await githubFetch<GitHubOrg[]>("/user/orgs", token);

  if (result.error) {
    return { ...result, data: null };
  }

  // Check required scopes
  const requiredScopes = ["read:org", "read:user"];
  const missingScopes = requiredScopes.filter(
    (s) => !result.scopes.includes(s)
  );

  if (missingScopes.length > 0) {
    return {
      ...result,
      data: null,
      error: `Token missing required scopes: ${missingScopes.join(", ")}`,
    };
  }

  const organizations = (result.data || []).map((org) => ({
    login: org.login,
    id: org.id,
    avatarUrl: org.avatar_url,
    description: org.description,
  }));

  return { ...result, data: { scopes: result.scopes, organizations } };
}

export async function fetchOrgMembers(
  token: string,
  orgLogin: string,
  onProgress?: (fetched: number) => void
) {
  const allMembers: GitHubOrgMember[] = [];
  let page = 1;
  let rateLimitRemaining = 5000;
  let rateLimitReset = 0;

  while (true) {
    const result = await githubFetch<GitHubOrgMember[]>(
      `/orgs/${encodeURIComponent(orgLogin)}/members`,
      token,
      { per_page: "100", page: String(page) }
    );

    rateLimitRemaining = result.rateLimitRemaining;
    rateLimitReset = result.rateLimitReset;

    if (result.error) {
      return {
        data: null,
        error: result.error,
        rateLimitRemaining,
        rateLimitReset,
      };
    }

    const members = result.data || [];
    allMembers.push(...members);
    onProgress?.(allMembers.length);

    if (members.length < 100) break;
    page++;

    if (rateLimitRemaining < 100) {
      return {
        data: null,
        error: `Rate limit approaching (${rateLimitRemaining} remaining). Reset at ${new Date(rateLimitReset * 1000).toISOString()}`,
        rateLimitRemaining,
        rateLimitReset,
      };
    }
  }

  return {
    data: allMembers,
    error: null,
    rateLimitRemaining,
    rateLimitReset,
  };
}

export async function fetchUserProfile(token: string, username: string) {
  const result = await githubFetch<GitHubUserProfile>(
    `/users/${encodeURIComponent(username)}`,
    token
  );

  if (result.error || !result.data) {
    return {
      data: null,
      error: result.error,
      rateLimitRemaining: result.rateLimitRemaining,
    };
  }

  const profile = result.data;
  return {
    data: {
      login: profile.login,
      id: profile.id,
      name: profile.name,
      email: profile.email,
      avatarUrl: profile.avatar_url,
      bio: profile.bio,
      publicRepos: profile.public_repos,
      profileUrl: profile.html_url,
    },
    error: null,
    rateLimitRemaining: result.rateLimitRemaining,
  };
}

export async function checkRateLimit(token: string) {
  interface RateLimitResponse {
    rate: { limit: number; remaining: number; reset: number };
  }
  const result = await githubFetch<RateLimitResponse>("/rate_limit", token);

  if (result.error || !result.data) {
    return { remaining: 0, limit: 0, reset: 0, error: result.error };
  }

  return {
    remaining: result.data.rate.remaining,
    limit: result.data.rate.limit,
    reset: result.data.rate.reset,
    error: null,
  };
}

// Pure function — matches GitHub org members to system users
export function matchMembersToUsers(
  members: GitHubMemberData[],
  systemUsers: Array<{
    id: number;
    name: string;
    email: string;
    githubUsername: string | null;
  }>
): {
  matched: SyncMatchedMember[];
  unmatched: SyncUnmatchedMember[];
  unmatchedSystemUsers: Array<{
    userId: number;
    userName: string;
    userEmail: string;
    githubUsername: string | null;
  }>;
  conflicts: SyncConflict[];
} {
  const matched: SyncMatchedMember[] = [];
  const unmatched: SyncUnmatchedMember[] = [];
  const conflicts: SyncConflict[] = [];
  const matchedUserIds = new Set<number>();

  // Build lookup maps (case-insensitive)
  const usernameMap = new Map<string, (typeof systemUsers)[number]>();
  const emailMap = new Map<string, (typeof systemUsers)[number]>();

  for (const user of systemUsers) {
    if (user.githubUsername) {
      const key = user.githubUsername.toLowerCase();
      if (!usernameMap.has(key)) {
        usernameMap.set(key, user);
      }
    }
    emailMap.set(user.email.toLowerCase(), user);
  }

  for (const member of members) {
    const loginLower = member.login.toLowerCase();
    const emailLower = member.email?.toLowerCase() || "";

    const usernameMatch = usernameMap.get(loginLower);
    const emailMatch = emailLower ? emailMap.get(emailLower) : undefined;

    let hasConflict = false;
    let conflictDetail: string | null = null;

    // Cross-match conflict detection
    if (usernameMatch && emailMatch && usernameMatch.id !== emailMatch.id) {
      hasConflict = true;
      conflictDetail = `Username matches user "${usernameMatch.name}" (ID ${usernameMatch.id}), but email matches user "${emailMatch.name}" (ID ${emailMatch.id}). Username match takes priority.`;
      conflicts.push({
        githubLogin: member.login,
        usernameMatchUserId: usernameMatch.id,
        emailMatchUserId: emailMatch.id,
        detail: conflictDetail,
      });
    }

    const matchedUser = usernameMatch || emailMatch;
    const matchType = usernameMatch
      ? ("username" as const)
      : ("email" as const);

    if (matchedUser) {
      matchedUserIds.add(matchedUser.id);
      matched.push({
        githubLogin: member.login,
        githubId: member.id,
        githubName: member.name,
        githubAvatarUrl: member.avatarUrl,
        githubBio: member.bio,
        githubPublicRepos: member.publicRepos,
        githubProfileUrl: member.profileUrl,
        githubEmail: member.email,
        matchedUserId: matchedUser.id,
        matchedUserName: matchedUser.name,
        matchedUserEmail: matchedUser.email,
        matchType,
        hasConflict,
        conflictDetail,
      });
    } else {
      unmatched.push({
        githubLogin: member.login,
        githubId: member.id,
        githubName: member.name,
        githubAvatarUrl: member.avatarUrl,
        githubBio: member.bio,
        githubPublicRepos: member.publicRepos,
        githubProfileUrl: member.profileUrl,
        githubEmail: member.email,
      });
    }
  }

  const unmatchedSystemUsers = systemUsers
    .filter((u) => !matchedUserIds.has(u.id))
    .map((u) => ({
      userId: u.id,
      userName: u.name,
      userEmail: u.email,
      githubUsername: u.githubUsername,
    }));

  return { matched, unmatched, unmatchedSystemUsers, conflicts };
}
