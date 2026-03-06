"use server";

import { db } from "@/lib/db";
import {
  githubConnections,
  githubProfiles,
  githubSyncEvents,
  users,
} from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
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

  for (const member of membersResult.data) {
    if (rateLimitRemaining < 100) {
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

  const systemUsers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      githubUsername: users.githubUsername,
    })
    .from(users)
    .where(eq(users.status, "active"));

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

  const { connection, memberProfiles, matchResult, rateLimitRemaining } = result;

  // Create sync event
  const [syncEvent] = await db
    .insert(githubSyncEvents)
    .values({
      connectionId: connection.id,
      triggeredBy: Number(admin.id),
      status: "in_progress",
      totalMembers: memberProfiles.length,
    })
    .returning({ id: githubSyncEvents.id });

  return {
    success: true,
    data: {
      syncEventId: syncEvent.id,
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

  const { syncEventId, importGitHubLogins } = parsed.data;

  const fetchResult = await fetchAndMatchMembers();
  if (!fetchResult.success) {
    return { success: false, error: fetchResult.error };
  }

  const { matchResult } = fetchResult;

  let enrichedCount = 0;
  let importedCount = 0;
  const adminId = Number(admin.id);

  // Enrich matched users
  for (const match of matchResult.matched) {
    // Upsert github_profiles
    const existingProfile = await db
      .select({ id: githubProfiles.id })
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
        { lastSyncedAt: { old: null, new: new Date().toISOString() } }
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

  // Update sync event
  await db
    .update(githubSyncEvents)
    .set({
      status: "completed",
      matchedCount: enrichedCount,
      importedCount,
      unmatchedCount: matchResult.unmatched.length - importedCount,
      conflictCount: matchResult.conflicts.length,
      completedAt: new Date(),
    })
    .where(eq(githubSyncEvents.id, syncEventId));

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
      skippedCount: matchResult.unmatched.length - importedCount,
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
