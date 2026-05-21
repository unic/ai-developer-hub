"use server";

import { db } from "@/lib/db";
import { githubConnections, githubProfiles, users } from "@/lib/db/schema";
import { eq, ilike, or, and, notInArray, asc } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";
import { decryptApiKey } from "@/lib/crypto";
import {
  fetchOrgMembers,
  fetchUserProfile,
  matchMembersToUsers,
} from "@/lib/github";
import { confirmSyncSchema } from "@/lib/validators";
import { recordCreation, recordUpdate } from "@/actions/history";
import { withSyncLock } from "@/lib/sync/framework";
import { revalidatePath } from "next/cache";
import { hash } from "bcryptjs";
import type { ActionResult, GitHubMemberData, SyncPreview } from "@/types";

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
    return {
      success: false,
      error: "Failed to decrypt stored token. Please update your token.",
    };
  }

  const membersResult = await fetchOrgMembers(token, connection.orgLogin);
  if (membersResult.error || !membersResult.data) {
    return {
      success: false,
      error: membersResult.error || "Failed to fetch organization members",
    };
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

  return {
    success: true,
    connection,
    memberProfiles,
    matchResult,
    rateLimitRemaining,
  };
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

export interface GitHubMemberSyncCounts {
  enrichedCount: number;
  importedCount: number;
  manuallyMatchedCount: number;
  createdCount: number;
  skippedCount: number;
  conflictCount: number;
}

export async function confirmGitHubSync(
  input: unknown,
): Promise<ActionResult<GitHubMemberSyncCounts & { eventId: number }>> {
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

  const { memberProfiles, matchResult } = fetchResult;

  // Build set of valid unmatched logins for validation (#9)
  const unmatchedLoginSet = new Set(
    matchResult.unmatched.map((m) => m.githubLogin),
  );

  const adminId = Number(admin.id);

  // TS's narrowing across async closures is unreliable for `let` variables;
  // a mutable property holder lets the callback record its detailed counts
  // without fighting the compiler.
  const detailed: { counts: GitHubMemberSyncCounts | null } = { counts: null };

  let lockResult: { eventId: number };
  try {
    lockResult = await withSyncLock(
      { sourceType: "github_members", triggeredBy: adminId },
      async () => {
        const result = await db.transaction(async (tx) => {
          let enrichedCount = 0;
          let importedCount = 0;

          // Enrich matched users
          for (const match of matchResult.matched) {
            const existingProfile = await tx
              .select({
                id: githubProfiles.id,
                lastSyncedAt: githubProfiles.lastSyncedAt,
              })
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
              await tx
                .update(githubProfiles)
                .set(profileData)
                .where(eq(githubProfiles.id, existingProfile[0].id));

              await recordUpdate(
                "github_profile",
                existingProfile[0].id,
                adminId,
                {
                  lastSyncedAt: {
                    old: existingProfile[0].lastSyncedAt?.toISOString() ?? null,
                    new: new Date().toISOString(),
                  },
                },
                tx,
              );
            } else {
              const [newProfile] = await tx
                .insert(githubProfiles)
                .values({
                  userId: match.matchedUserId,
                  ...profileData,
                })
                .returning({ id: githubProfiles.id });

              await recordCreation(
                "github_profile",
                newProfile.id,
                adminId,
                tx,
              );
            }

            // Populate githubUsername if matched by email and field was empty
            if (match.matchType === "email") {
              const [user] = await tx
                .select({ githubUsername: users.githubUsername })
                .from(users)
                .where(eq(users.id, match.matchedUserId))
                .limit(1);

              if (user && !user.githubUsername) {
                await tx
                  .update(users)
                  .set({
                    githubUsername: match.githubLogin,
                    updatedAt: new Date(),
                  })
                  .where(eq(users.id, match.matchedUserId));

                await recordUpdate(
                  "user",
                  match.matchedUserId,
                  adminId,
                  {
                    githubUsername: { old: null, new: match.githubLogin },
                  },
                  tx,
                );
              }
            }

            enrichedCount++;
          }

          // Import selected unmatched members
          const importSet = new Set(importGitHubLogins);
          const toImport = matchResult.unmatched.filter((m) =>
            importSet.has(m.githubLogin),
          );

          const tempPasswordHash = await hash("changeme123", 12);

          for (const member of toImport) {
            const [newUser] = await tx
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

            await recordCreation("user", newUser.id, adminId, tx);

            const [newProfile] = await tx
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

            await recordCreation("github_profile", newProfile.id, adminId, tx);
            importedCount++;
          }

          // Process manual matches (T013)
          let manuallyMatchedCount = 0;
          const memberLookup = new Map(
            memberProfiles.map((m) => [m.login.toLowerCase(), m]),
          );
          const errors: string[] = [];

          for (const mm of manualMatches) {
            // Validate githubLogin is in the unmatched set (#9)
            if (!unmatchedLoginSet.has(mm.githubLogin)) continue;

            // Validate user exists
            const [targetUser] = await tx
              .select({ id: users.id, githubUsername: users.githubUsername })
              .from(users)
              .where(eq(users.id, mm.userId))
              .limit(1);

            if (!targetUser) continue;

            // Check githubUsername uniqueness before updating (#1)
            const [conflictingUser] = await tx
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(
                and(
                  eq(users.githubUsername, mm.githubLogin),
                  notInArray(users.id, [mm.userId]),
                ),
              )
              .limit(1);

            if (conflictingUser) {
              errors.push(
                `GitHub login "${mm.githubLogin}" is already linked to user "${conflictingUser.name}" (ID ${conflictingUser.id})`,
              );
              continue;
            }

            const previousGithubUsername = targetUser.githubUsername;

            await tx
              .update(users)
              .set({ githubUsername: mm.githubLogin, updatedAt: new Date() })
              .where(eq(users.id, mm.userId));

            await recordUpdate(
              "user",
              mm.userId,
              adminId,
              {
                githubUsername: {
                  old: previousGithubUsername ?? null,
                  new: mm.githubLogin,
                },
              },
              tx,
            );

            // Upsert githubProfiles with enriched data
            const memberData = memberLookup.get(mm.githubLogin.toLowerCase());
            if (memberData) {
              const existingProfile = await tx
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
                await tx
                  .update(githubProfiles)
                  .set(profileData)
                  .where(eq(githubProfiles.id, existingProfile[0].id));
              } else {
                await tx
                  .insert(githubProfiles)
                  .values({ userId: mm.userId, ...profileData });
              }
            }

            manuallyMatchedCount++;
          }

          // Process new users (T016)
          let createdCount = 0;

          for (const nu of newUsers) {
            // Validate githubLogin is in the unmatched set (#9)
            if (!unmatchedLoginSet.has(nu.githubLogin)) continue;

            // Validate email uniqueness (#2)
            const [existingByEmail] = await tx
              .select({ id: users.id })
              .from(users)
              .where(eq(users.email, nu.email))
              .limit(1);

            if (existingByEmail) {
              errors.push(
                `Email "${nu.email}" is already in use for GitHub member "${nu.githubLogin}"`,
              );
              continue;
            }

            // Validate githubUsername uniqueness (#2)
            const [existingByGithub] = await tx
              .select({ id: users.id })
              .from(users)
              .where(eq(users.githubUsername, nu.githubLogin))
              .limit(1);

            if (existingByGithub) {
              errors.push(
                `GitHub login "${nu.githubLogin}" is already linked to another user`,
              );
              continue;
            }

            const [newInlineUser] = await tx
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

            await recordCreation("user", newInlineUser.id, adminId, tx);

            const memberData = memberLookup.get(nu.githubLogin.toLowerCase());
            if (memberData) {
              const [newProfile] = await tx
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

              await recordCreation(
                "github_profile",
                newProfile.id,
                adminId,
                tx,
              );
            }

            createdCount++;
          }

          const totalResolved =
            importedCount + manuallyMatchedCount + createdCount;
          const unmatchedCount = Math.max(
            0,
            matchResult.unmatched.length - totalResolved,
          );

          // Update connection lastSyncAt
          await tx
            .update(githubConnections)
            .set({ lastSyncAt: new Date() })
            .where(eq(githubConnections.status, "active"));

          return {
            enrichedCount,
            importedCount,
            manuallyMatchedCount,
            createdCount,
            skippedCount: unmatchedCount,
            conflictCount: matchResult.conflicts.length,
            errors,
          };
        });

        detailed.counts = {
          enrichedCount: result.enrichedCount,
          importedCount: result.importedCount,
          manuallyMatchedCount: result.manuallyMatchedCount,
          createdCount: result.createdCount,
          skippedCount: result.skippedCount,
          conflictCount: result.conflictCount,
        };

        // errorCount aggregates both validation errors raised mid-run
        // (duplicate email/login) and pre-existing match conflicts that
        // blocked resolution. Both warrant a non-success outcome on the
        // sync_events row so the dashboard surfaces them.
        return {
          createdCount: result.importedCount + result.createdCount,
          updatedCount: result.enrichedCount + result.manuallyMatchedCount,
          skippedCount: result.skippedCount,
          errorCount: result.errors.length + result.conflictCount,
          errorMessage:
            result.errors.length > 0 ? result.errors.join("; ") : null,
        };
      },
    );
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Sync failed unexpectedly",
    };
  }

  if (!detailed.counts) {
    return { success: false, error: "Sync did not complete" };
  }

  revalidatePath("/users");
  revalidatePath("/settings/integrations");

  return {
    success: true,
    data: { ...detailed.counts, eventId: lockResult.eventId },
  };
}

export async function searchUsersForMatching(input: {
  query: string;
  excludeUserIds?: number[];
}): Promise<
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

  const conditions = [
    or(ilike(users.name, searchPattern), ilike(users.email, searchPattern)),
  ];

  if (excludeUserIds && excludeUserIds.length > 0) {
    conditions.push(notInArray(users.id, excludeUserIds));
  }

  const results = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      status: users.status,
      githubUsername: users.githubUsername,
    })
    .from(users)
    .where(and(...conditions))
    .orderBy(asc(users.status), asc(users.name))
    .limit(20);

  return {
    success: true,
    data: results as Array<{
      id: number;
      name: string;
      email: string;
      status: "active" | "inactive";
      githubUsername: string | null;
    }>,
  };
}
