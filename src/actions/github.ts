"use server";

import { db } from "@/lib/db";
import { githubConnections, githubProfiles } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth-helpers";
import { encryptApiKey, decryptApiKey } from "@/lib/crypto";
import { validateTokenAndListOrgs } from "@/lib/github";
import { githubTokenSchema, connectOrgSchema } from "@/lib/validators";
import { recordCreation, recordStatusChange, recordUpdate } from "@/actions/history";
import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/types";

export async function getActiveGitHubConnection(): Promise<
  ActionResult<{
    connection: {
      id: number;
      orgLogin: string;
      orgAvatarUrl: string | null;
      status: string;
      connectedAt: Date;
      lastSyncAt: Date | null;
    } | null;
  }>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const [connection] = await db
    .select({
      id: githubConnections.id,
      orgLogin: githubConnections.orgLogin,
      orgAvatarUrl: githubConnections.orgAvatarUrl,
      status: githubConnections.status,
      connectedAt: githubConnections.connectedAt,
      lastSyncAt: githubConnections.lastSyncAt,
    })
    .from(githubConnections)
    .where(eq(githubConnections.status, "active"))
    .limit(1);

  return { success: true, data: { connection: connection ?? null } };
}

export async function validateGitHubToken(
  input: unknown
): Promise<
  ActionResult<{
    scopes: string[];
    organizations: Array<{
      login: string;
      id: number;
      avatarUrl: string | null;
      description: string | null;
    }>;
  }>
> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = githubTokenSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const result = await validateTokenAndListOrgs(parsed.data.token);

  if (result.error || !result.data) {
    return { success: false, error: result.error || "Failed to validate token" };
  }

  return { success: true, data: result.data };
}

export async function connectGitHubOrg(
  input: unknown
): Promise<ActionResult<{ connectionId: number }>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = connectOrgSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { token, orgLogin, orgId } = parsed.data;

  // Validate the token again to get scopes and confirm org access
  const validation = await validateTokenAndListOrgs(token);
  if (validation.error || !validation.data) {
    return {
      success: false,
      error: validation.error || "Failed to validate token",
    };
  }

  const orgMatch = validation.data.organizations.find((o) => o.login === orgLogin);
  if (!orgMatch) {
    return {
      success: false,
      error: `Token does not have access to organization "${orgLogin}"`,
    };
  }

  const tokenEncrypted = await encryptApiKey(token);

  // Transaction: disconnect any existing active connection, then create new one
  const result = await db.transaction(async (tx) => {
    // Disconnect existing active connections
    const existing = await tx
      .select({ id: githubConnections.id })
      .from(githubConnections)
      .where(eq(githubConnections.status, "active"));

    for (const conn of existing) {
      await tx
        .update(githubConnections)
        .set({
          status: "disconnected",
          disconnectedAt: new Date(),
          tokenEncrypted: "",
        })
        .where(eq(githubConnections.id, conn.id));
    }

    // Create new connection
    const [newConn] = await tx
      .insert(githubConnections)
      .values({
        orgLogin,
        orgId,
        orgAvatarUrl: orgMatch.avatarUrl,
        tokenEncrypted,
        tokenScopesCsv: validation.data!.scopes.join(","),
        status: "active",
        connectedBy: Number(admin.id),
      })
      .returning({ id: githubConnections.id });

    return newConn;
  });

  await recordCreation("github_connection", result.id, Number(admin.id));
  revalidatePath("/settings/integrations");

  return { success: true, data: { connectionId: result.id } };
}

export async function disconnectGitHubOrg(): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const [connection] = await db
    .select({ id: githubConnections.id })
    .from(githubConnections)
    .where(eq(githubConnections.status, "active"))
    .limit(1);

  if (!connection) {
    return { success: false, error: "No active GitHub connection found" };
  }

  await db
    .update(githubConnections)
    .set({
      status: "disconnected",
      disconnectedAt: new Date(),
      tokenEncrypted: "",
    })
    .where(eq(githubConnections.id, connection.id));

  await recordStatusChange(
    "github_connection",
    connection.id,
    Number(admin.id),
    "active",
    "disconnected"
  );

  revalidatePath("/settings/integrations");
  return { success: true, data: undefined };
}

export async function updateGitHubToken(
  input: unknown
): Promise<ActionResult<void>> {
  const admin = await requireAdmin();
  if (!admin) return { success: false, error: "Unauthorized" };

  const parsed = githubTokenSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const [connection] = await db
    .select({
      id: githubConnections.id,
      orgLogin: githubConnections.orgLogin,
    })
    .from(githubConnections)
    .where(eq(githubConnections.status, "active"))
    .limit(1);

  if (!connection) {
    return { success: false, error: "No active GitHub connection found" };
  }

  // Validate new token
  const validation = await validateTokenAndListOrgs(parsed.data.token);
  if (validation.error || !validation.data) {
    return {
      success: false,
      error: validation.error || "Failed to validate token",
    };
  }

  const orgMatch = validation.data.organizations.find(
    (o) => o.login === connection.orgLogin
  );
  if (!orgMatch) {
    return {
      success: false,
      error: `New token does not have access to organization "${connection.orgLogin}"`,
    };
  }

  const tokenEncrypted = await encryptApiKey(parsed.data.token);

  await db
    .update(githubConnections)
    .set({
      tokenEncrypted,
      tokenScopesCsv: validation.data.scopes.join(","),
    })
    .where(eq(githubConnections.id, connection.id));

  await recordUpdate("github_connection", connection.id, Number(admin.id), {
    tokenEncrypted: { old: "[redacted]", new: "[updated]" },
  });

  revalidatePath("/settings/integrations");
  return { success: true, data: undefined };
}

export async function getGitHubProfile(
  userId: number
): Promise<
  ActionResult<{
    profile: {
      githubLogin: string;
      avatarUrl: string | null;
      bio: string | null;
      publicRepos: number | null;
      profileUrl: string | null;
      name: string | null;
      lastSyncedAt: Date;
    } | null;
  }>
> {
  const [profile] = await db
    .select({
      githubLogin: githubProfiles.githubLogin,
      avatarUrl: githubProfiles.avatarUrl,
      bio: githubProfiles.bio,
      publicRepos: githubProfiles.publicRepos,
      profileUrl: githubProfiles.profileUrl,
      name: githubProfiles.name,
      lastSyncedAt: githubProfiles.lastSyncedAt,
    })
    .from(githubProfiles)
    .where(eq(githubProfiles.userId, userId))
    .limit(1);

  return { success: true, data: { profile: profile ?? null } };
}
