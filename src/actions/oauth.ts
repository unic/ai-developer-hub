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
  validateAuthorizeRequest,
  type AuthorizeParams,
} from "@/lib/oauth/authorize";
import { issueAuthCode, revokeGrantForUser } from "@/lib/oauth/store";

function authorizeParamsFromForm(formData: FormData): AuthorizeParams {
  const read = (key: string): string | undefined => {
    const value = formData.get(key);
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  return {
    client_id: read("client_id"),
    redirect_uri: read("redirect_uri"),
    response_type: read("response_type"),
    code_challenge: read("code_challenge"),
    code_challenge_method: read("code_challenge_method"),
    scope: read("scope"),
    state: read("state"),
  };
}

/**
 * Consent "Allow" — re-validates the full authorization request (form fields
 * are client-controlled), issues a single-use code bound to the signed-in
 * user, and redirects back to the client.
 */
export async function approveAuthorization(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || session.user.isAgent) {
    throw new Error("Unauthorized");
  }

  const validation = await validateAuthorizeRequest(
    authorizeParamsFromForm(formData),
  );
  if (!validation.ok) {
    if (validation.fatal) throw new Error(validation.message);
    redirect(validation.redirectTo);
  }

  const code = await issueAuthCode({
    clientRowId: validation.client.id,
    userId: Number(session.user.id),
    redirectUri: validation.redirectUri,
    codeChallenge: validation.codeChallenge,
    scope: validation.grantedScope,
  });

  redirect(buildRedirect(validation.redirectUri, { code, state: validation.state }));
}

/** Consent "Deny" — informs the client via the standard error redirect. */
export async function denyAuthorization(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const validation = await validateAuthorizeRequest(
    authorizeParamsFromForm(formData),
  );
  if (!validation.ok) {
    if (validation.fatal) throw new Error(validation.message);
    redirect(validation.redirectTo);
  }

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
