"use server";

/**
 * Server actions for the embedded MCP OAuth server (038-mcp-v2): consent
 * approval/denial on /oauth/authorize and grant revocation from
 * /settings/connections.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import {
  buildRedirect,
  readAuthorizeParams,
  validateAuthorizeRequest,
} from "@/lib/oauth/authorize";
import { issueAuthCode, revokeGrantForUser } from "@/lib/oauth/store";
import { resolveGrantedScope } from "@/lib/oauth/validate";

/**
 * Shared head of both consent actions: require a session and re-validate the
 * full authorization request (hidden form fields are client-controlled).
 * Redirects with an OAuth error for client-deliverable failures, throws for
 * fatal ones, and returns the validated request plus the acting user id.
 */
async function validateConsentSubmission(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id || session.user.isAgent) {
    throw new Error("Unauthorized");
  }

  const params = readAuthorizeParams((key) => {
    const value = formData.get(key);
    return typeof value === "string" && value !== "" ? value : undefined;
  });

  const validation = await validateAuthorizeRequest(params);
  if (!validation.ok) {
    if (validation.fatal) throw new Error(validation.message);
    redirect(validation.redirectTo);
  }

  return {
    validation,
    userId: Number(session.user.id),
    // Carried out so approveAuthorization can resolve mcp:write from the SESSION
    // role rather than from anything the (client-controlled) form said. 043.
    consenterRole: session.user.role,
  };
}

/**
 * Consent "Allow" — issues a single-use code bound to the signed-in user and
 * redirects back to the client.
 */
export async function approveAuthorization(formData: FormData): Promise<void> {
  const { validation, userId, consenterRole } =
    await validateConsentSubmission(formData);

  const code = await issueAuthCode({
    clientRowId: validation.client.id,
    userId,
    redirectUri: validation.redirectUri,
    codeChallenge: validation.codeChallenge,
    // mcp:write only when the client asked AND this session is an admin.
    scope: resolveGrantedScope(validation.requestedScope, consenterRole),
  });

  redirect(buildRedirect(validation.redirectUri, { code, state: validation.state }));
}

/** Consent "Deny" — informs the client via the standard error redirect. */
export async function denyAuthorization(formData: FormData): Promise<void> {
  const { validation } = await validateConsentSubmission(formData);

  redirect(
    buildRedirect(validation.redirectUri, {
      error: "access_denied",
      error_description: "The user denied the request",
      state: validation.state,
    }),
  );
}

/** Revoke one of the signed-in user's own MCP connections (token family). */
export async function revokeConnection(
  familyId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized" };
  }

  const revoked = await revokeGrantForUser(Number(session.user.id), familyId);
  if (!revoked) {
    return { success: false, error: "Connection not found" };
  }

  revalidatePath("/settings/connections");
  return { success: true };
}
