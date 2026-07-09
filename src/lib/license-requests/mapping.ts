// Tool mapping resolution (032-v2) — how (role, profile) from the request
// form resolves to a proposed tool. Rules live in the tool_mappings table
// (seeded from the AI Tooling Guide, editable under Settings); this module is
// deliberately pure — the ingest route supplies the candidate rows — so the
// resolution semantics unit-test without a database.

/** Vocabulary the Microsoft Form sends. */
export const FORM_ROLES = ["development", "conception", "business"] as const;
export type FormRole = (typeof FORM_ROLES)[number];

/** DB vocabulary (user_discipline enum). */
export type RequesterRole = "developer" | "conception" | "business";
export type RequesterProfile = "baseline" | "maxed" | "indie";

/** The Form says "development"; the user_discipline enum says "developer". */
export function normalizeRole(role: FormRole): RequesterRole {
  return role === "development" ? "developer" : role;
}

/** Empty profile on the Form means baseline. */
export function normalizeProfile(
  profile: "" | "maxed" | "indie" | undefined,
): RequesterProfile {
  return profile === "maxed" || profile === "indie" ? profile : "baseline";
}

export interface MappingRow {
  role: RequesterRole | null;
  profile: RequesterProfile;
  toolId: number | null;
  defaultTierId: number | null;
}

/**
 * Pure resolution over candidate rows: exact (role, profile) wins over the
 * any-role (NULL, profile) row; no row (or a toolId-less row) means
 * "needs decision" — the approver picks the tool on the request.
 */
export function pickMapping<T extends MappingRow>(
  rows: T[],
  role: RequesterRole,
  profile: RequesterProfile,
): T | null {
  const candidates = rows.filter((r) => r.profile === profile);
  return (
    candidates.find((r) => r.role === role) ??
    candidates.find((r) => r.role === null) ??
    null
  );
}
