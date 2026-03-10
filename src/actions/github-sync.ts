"use server";

import { db } from "@/lib/db";
import {
  githubConnections,
  githubProfiles,
  githubSyncEvents,
  users,
} from "@/lib/db/schema";
import { eq, desc, ilike, or, notInArray, asc } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";
import { decryptApiKey } from "@/lib/crypto";
import {
  fetchOrgMembers,
  fetchUserProfile,
  matchMembersToUsers,
} from "@/lib/github";
import { confirmSyncSchema } from "@/lib/validators";
import { recordCreation, recordUpdate } from "@/actions/history";
import { revalidatePath } from "next/cache";
import { hash } from "bcryptjs";
import type { ActionResult, GitHubMemberData, GitHubSyncStatus, SyncPreview } from "@/types";

/** Shared helper: get active connection, decrypt token, fetch members, match to users */
async function fetchAndMatchMembers(): Promise<
  | { success: false; error: string }
  | {
      success: true;
      connection: { id: number; orgLogin: string };
      memberProfiles: GitHubMemberData[];
      matchResult: ReturnType<typeof matchMembersToUsers>;
      rateLimitRemaining: number;
    }
> {
  const [connection] = await db
    .select()
    .from(githubConnections)
    .where(eq(githubConnections.status, "active"))
    .limit(1);

  if (!connection) {
    return { success: false, error: "No active GitHub connection found" };
  }

  let token: string;
  try {
    token = await decryptApiKey(connection.tokenEncrypted);
  } catch {
    return { success: false, error: "Failed to decrypt stored token. Please update your token." };
  }

  const membersResult = await fetchOrgMembers(token, connection.orgLogin);
  if (membersResult.error || !membersResult.data) {
    return { success: false, error: membersResult.error || "Failed to fetch organization members" };
  }

  const memberProfiles: GitHubMemberData[] = [];
  let rateLimitRemaining = membersResult.rateLimitRemaining;
  let rateLimitedDuringFetch = false;

  for (const member of membersResult.data) {
    if (rateLimitRemaining < 100) {
      rateLimitedDuringFetch = true;
      break;
    }

    const profileResult = await fetchUserProfile(token, member.login);
    rateLimitRemaining = profileResult.rateLimitRemaining;

    if (profileResult.data) {
      memberProfiles.push(profileResult.data);
    } else {
      memberProfiles.push({
        login: member.login,
        id: member.id,
        name: null,
        email: null,
        avatarUrl: member.avatar_url,
        bio: null,
        publicRepos: null,
        profileUrl: `https://github.com/${member.login}`,
      });
    }
  }

  if (rateLimitedDuringFetch) {
    return {
      success: false,
      error: `Rate limit low (${rateLimitRemaining} remaining). Only ${memberProfiles.length}/${membersResult.data.length} profiles fetched. Please try again later.`,
    };
  }

  const systemUsers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      githubUsername: users.githubUsername,
      status: users.status,
    })
    .from(users);

  const matchResult = matchMembersToUsers(memberProfiles, systemUsers);

  return { success: true, connection, memberProfiles, matchResult, rateLimitRemaining };
}

export async function fetchGitHubSyncPreview(): Promise<
  ActionResult<SyncPreview>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const result = await fetchAndMatchMembers();
  if (!result.success) {
    return { success: false, error: result.error };
  }

  const { memberProfiles, matchResult, rateLimitRemaining } = result;

  return {
    success: true,
    data: {
      totalMembers: memberProfiles.length,
      matched: matchResult.matched,
      unmatched: matchResult.unmatched,
      unmatchedSystemUsers: matchResult.unmatchedSystemUsers,
      conflicts: matchResult.conflicts,
      rateLimitRemaining,
    },
  };
}

export async function confirmGitHubSync(
  input: unknown
): Promise<
  ActionResult<{
    enrichedCount: number;
    importedCount: number;
    manuallyMatchedCount: number;
    createdCount: number;
    skippedCount: number;
    conflictCount: number;
  }>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = confirmSyncSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { importGitHubLogins, manualMatches, newUsers } = parsed.data;

  const fetchResult = await fetchAndMatchMembers();
  if (!fetchResult.success) {
    return { success: false, error: fetchResult.error };
  }

  const { connection, memberProfiles, matchResult } = fetchResult;

  // Create sync event at confirm time (not preview) to avoid orphaned records
  const [syncEvent] = await db
    .insert(githubSyncEvents)
    .values({
      connectionId: connection.id,
      triggeredBy: Number(admin.id),
      status: "in_progress",
      totalMembers: memberProfiles.length,
    })
    .returning({ id: githubSyncEvents.id });

  let enrichedCount = 0;
  let importedCount = 0;
  const adminId = Number(admin.id);

  // Enrich matched users
  for (const match of matchResult.matched) {
    // Upsert github_profiles
    const existingProfile = await db
      .select({ id: githubProfiles.id, lastSyncedAt: githubProfiles.lastSyncedAt })
      .from(githubProfiles)
      .where(eq(githubProfiles.userId, match.matchedUserId))
      .limit(1);

    const profileData = {
      githubId: match.githubId,
      githubLogin: match.githubLogin,
      avatarUrl: match.githubAvatarUrl,
      bio: match.githubBio,
      publicRepos: match.githubPublicRepos,
      profileUrl: match.githubProfileUrl,
      name: match.githubName,
      email: match.githubEmail,
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    };

    if (existingProfile.length > 0) {
      await db
        .update(githubProfiles)
        .set(profileData)
        .where(eq(githubProfiles.id, existingProfile[0].id));

      await recordUpdate(
        "github_profile",
        existingProfile[0].id,
        adminId,
        { lastSyncedAt: { old: existingProfile[0].lastSyncedAt?.toISOString() ?? null, new: new Date().toISOString() } }
      );
    } else {
      const [newProfile] = await db
        .insert(githubProfiles)
        .values({
          userId: match.matchedUserId,
          ...profileData,
        })
        .returning({ id: githubProfiles.id });

      await recordCreation("github_profile", newProfile.id, adminId);
    }

    // Populate githubUsername if matched by email and field was empty
    if (match.matchType === "email") {
      const [user] = await db
        .select({ githubUsername: users.githubUsername })
        .from(users)
        .where(eq(users.id, match.matchedUserId))
        .limit(1);

      if (user && !user.githubUsername) {
        await db
          .update(users)
          .set({ githubUsername: match.githubLogin, updatedAt: new Date() })
          .where(eq(users.id, match.matchedUserId));

        await recordUpdate("user", match.matchedUserId, adminId, {
          githubUsername: { old: null, new: match.githubLogin },
        });
      }
    }

    enrichedCount++;
  }

  // Import selected unmatched members
  const importSet = new Set(importGitHubLogins);
  const toImport = matchResult.unmatched.filter((m) =>
    importSet.has(m.githubLogin)
  );

  const tempPasswordHash = await hash("changeme123", 12);

  for (const member of toImport) {
    const [newUser] = await db
      .insert(users)
      .values({
        name: member.githubName || member.githubLogin,
        email:
          member.githubEmail || `${member.githubLogin}@github.invalid`,
        passwordHash: tempPasswordHash,
        githubUsername: member.githubLogin,
        role: "viewer",
        status: "active",
      })
      .returning({ id: users.id });

    await recordCreation("user", newUser.id, adminId);

    // Create github_profile for imported user
    const [newProfile] = await db
      .insert(githubProfiles)
      .values({
        userId: newUser.id,
        githubId: member.githubId,
        githubLogin: member.githubLogin,
        avatarUrl: member.githubAvatarUrl,
        bio: member.githubBio,
        publicRepos: member.githubPublicRepos,
        profileUrl: member.githubProfileUrl,
        name: member.githubName,
        email: member.githubEmail,
        lastSyncedAt: new Date(),
      })
      .returning({ id: githubProfiles.id });

    await recordCreation("github_profile", newProfile.id, adminId);
    importedCount++;
  }

  // Process manual matches (T013)
  let manuallyMatchedCount = 0;
  const memberLookup = new Map(memberProfiles.map((m) => [m.login.toLowerCase(), m]));

  for (const mm of manualMatches) {
    // Validate user exists
    const [targetUser] = await db
      .select({ id: users.id, githubUsername: users.githubUsername })
      .from(users)
      .where(eq(users.id, mm.userId))
      .limit(1);

    if (!targetUser) continue;

    const previousGithubUsername = targetUser.githubUsername;

    // Update users.githubUsername
    await db
      .update(users)
      .set({ githubUsername: mm.githubLogin, updatedAt: new Date() })
      .where(eq(users.id, mm.userId));

    await recordUpdate("user", mm.userId, adminId, {
      githubUsername: { old: previousGithubUsername ?? null, new: mm.githubLogin },
    });

    // Upsert githubProfiles with enriched data
    const memberData = memberLookup.get(mm.githubLogin.toLowerCase());
    if (memberData) {
      const existingProfile = await db
        .select({ id: githubProfiles.id })
        .from(githubProfiles)
        .where(eq(githubProfiles.userId, mm.userId))
        .limit(1);

      const profileData = {
        githubId: memberData.id,
        githubLogin: memberData.login,
        avatarUrl: memberData.avatarUrl,
        bio: memberData.bio,
        publicRepos: memberData.publicRepos,
        profileUrl: memberData.profileUrl,
        name: memberData.name,
        email: memberData.email,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      };

      if (existingProfile.length > 0) {
        await db
          .update(githubProfiles)
          .set(profileData)
          .where(eq(githubProfiles.id, existingProfile[0].id));
      } else {
        await db
          .insert(githubProfiles)
          .values({ userId: mm.userId, ...profileData });
      }
    }

    manuallyMatchedCount++;
  }

  // Process new users (T016)
  let createdCount = 0;

  for (const nu of newUsers) {
    // Validate email uniqueness
    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, nu.email))
      .limit(1);

    if (existingUser) continue; // Skip if email already taken

    const [newInlineUser] = await db
      .insert(users)
      .values({
        name: nu.name,
        email: nu.email,
        passwordHash: tempPasswordHash,
        githubUsername: nu.githubLogin,
        role: "viewer",
        status: "active",
      })
      .returning({ id: users.id });

    await recordCreation("user", newInlineUser.id, adminId);

    // Upsert githubProfiles
    const memberData = memberLookup.get(nu.githubLogin.toLowerCase());
    if (memberData) {
      const [newProfile] = await db
        .insert(githubProfiles)
        .values({
          userId: newInlineUser.id,
          githubId: memberData.id,
          githubLogin: memberData.login,
          avatarUrl: memberData.avatarUrl,
          bio: memberData.bio,
          publicRepos: memberData.publicRepos,
          profileUrl: memberData.profileUrl,
          name: memberData.name,
          email: memberData.email,
          lastSyncedAt: new Date(),
        })
        .returning({ id: githubProfiles.id });

      await recordCreation("github_profile", newProfile.id, adminId);
    }

    createdCount++;
  }

  const totalResolved = importedCount + manuallyMatchedCount + createdCount;

  // Update sync event
  await db
    .update(githubSyncEvents)
    .set({
      status: "completed",
      matchedCount: enrichedCount,
      importedCount,
      manuallyMatchedCount,
      createdCount,
      unmatchedCount: matchResult.unmatched.length - totalResolved,
      conflictCount: matchResult.conflicts.length,
      completedAt: new Date(),
    })
    .where(eq(githubSyncEvents.id, syncEvent.id));

  // Update connection lastSyncAt
  await db
    .update(githubConnections)
    .set({ lastSyncAt: new Date() })
    .where(eq(githubConnections.status, "active"));

  revalidatePath("/users");
  revalidatePath("/settings/integrations");

  return {
    success: true,
    data: {
      enrichedCount,
      importedCount,
      manuallyMatchedCount,
      createdCount,
      skippedCount: matchResult.unmatched.length - totalResolved,
      conflictCount: matchResult.conflicts.length,
    },
  };
}

export async function getSyncHistory(
  limit = 10
): Promise<
  ActionResult<{
    events: Array<{
      id: number;
      status: GitHubSyncStatus;
      totalMembers: number | null;
      matchedCount: number | null;
      importedCount: number | null;
      unmatchedCount: number | null;
      manuallyMatchedCount: number | null;
      createdCount: number | null;
      startedAt: Date;
      completedAt: Date | null;
      triggeredByName: string;
    }>;
  }>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const events = await db
    .select({
      id: githubSyncEvents.id,
      status: githubSyncEvents.status,
      totalMembers: githubSyncEvents.totalMembers,
      matchedCount: githubSyncEvents.matchedCount,
      importedCount: githubSyncEvents.importedCount,
      unmatchedCount: githubSyncEvents.unmatchedCount,
      manuallyMatchedCount: githubSyncEvents.manuallyMatchedCount,
      createdCount: githubSyncEvents.createdCount,
      startedAt: githubSyncEvents.startedAt,
      completedAt: githubSyncEvents.completedAt,
      triggeredByName: users.name,
    })
    .from(githubSyncEvents)
    .innerJoin(users, eq(githubSyncEvents.triggeredBy, users.id))
    .orderBy(desc(githubSyncEvents.startedAt))
    .limit(limit);

  return { success: true, data: { events } };
}

export async function searchUsersForMatching(
  input: { query: string; excludeUserIds?: number[] }
): Promise<
  ActionResult<
    Array<{
      id: number;
      name: string;
      email: string;
      status: "active" | "inactive";
      githubUsername: string | null;
    }>
  >
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const { query, excludeUserIds } = input;
  if (!query || query.trim().length === 0) {
    return { success: true, data: [] };
  }

  const searchPattern = `%${query.trim()}%`;

  // Fetch more than 20 to account for excludeUserIds filtering
  const fetchLimit = excludeUserIds?.length ? 20 + excludeUserIds.length : 20;

  const results = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      status: users.status,
      githubUsername: users.githubUsername,
    })
    .from(users)
    .where(
      or(
        ilike(users.name, searchPattern),
        ilike(users.email, searchPattern)
      )
    )
    .orderBy(asc(users.status), asc(users.name))
    .limit(fetchLimit);

  const excludeSet = excludeUserIds ? new Set(excludeUserIds) : null;
  const filtered = excludeSet
    ? results.filter((u) => !excludeSet.has(u.id))
    : results;

  return {
    success: true,
    data: filtered.slice(0, 20) as Array<{
      id: number;
      name: string;
      email: string;
      status: "active" | "inactive";
      githubUsername: string | null;
    }>,
  };
}
