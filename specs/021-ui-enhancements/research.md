# Research: 021-ui-enhancements

**Date**: 2026-03-24

## R1: Inline Editing Pattern on User Detail Page

**Decision**: Reuse the existing React Hook Form + Zod pattern from `assignment-detail-client.tsx` for the unified view. The user detail page does NOT actually use inline editing — it uses a separate edit form card. The assignment detail page already has the same pattern (detail card + edit card). The "unification" means merging these two cards into one, where each field shows its current value with an adjacent edit control.

**Rationale**: The current assignment detail page already uses `useForm<UpdateAssignmentInput>` with `zodResolver(updateAssignmentSchema)`. The edit form fields (tier select, date picker, workspace input, API key input) can be embedded directly into the detail card rows instead of living in a separate card. This eliminates the duplicate display without changing the underlying form mechanics.

**Alternatives considered**:
- Individual field-level inline edit (click to edit pattern): More complex, requires per-field save endpoints. Rejected — the current batch-save pattern works well.
- Keep separate cards but remove read-only duplication from edit card: Still leaves two cards. Rejected — doesn't match the "combined" requirement.

## R2: Making Tool Entries Clickable

**Decision**: Wrap each tool entry in the "Assigned Tools" card with a Next.js `Link` component pointing to `/assignments/{assignment.id}`.

**Rationale**: The `assignments` data passed to `user-detail-client.tsx` already includes `a.id` (assignment ID). The assignment detail page already exists at `/assignments/[id]`. This is a one-line change per entry — wrap the existing `<div>` content in `<Link href={/assignments/${a.id}}>`.

**Alternatives considered**:
- Using `router.push()` on click handler: Works but semantically worse — a `<Link>` gives proper anchor behavior (right-click, cmd+click, accessibility).
- Making only the tool name clickable vs. the entire row: Entire row is more discoverable and consistent with table row click patterns used elsewhere.

## R3: Removing User-Creation-Date Validation

**Decision**: Remove the `newDate < assignment.user.createdAt` check in `updateAssignment()` (lines 236-241 of `src/actions/assignments.ts`). Keep the tool-creation-date check and the future-date check.

**Rationale**: The spec explicitly requires allowing dates before user creation for backdating scenarios. The tool-creation-date check still makes logical sense (can't assign a tool before it existed). The 12-month warning remains as a soft guard.

**Alternatives considered**:
- Making it a warning instead of an error: Adds complexity without clear benefit — if we're allowing it, just allow it.
- Adding a separate "backdate" flag: Over-engineering for a simple validation removal.

## R4: Adding Workspace/API Key to New Assignment Form

**Decision**: Extend `assignmentSchema` in validators.ts with optional `workspace` and `apiKey` fields. Update `assignLicense()` in `src/actions/assignments.ts` to accept and process these fields, including API key encryption via `encryptApiKey()` from `src/lib/crypto.ts`. Add corresponding UI fields to the assignment dialog in `user-detail-client.tsx`.

**Rationale**: The database schema already has `workspace` and `apiKeyEncrypted` columns. The `updateAssignment` action already handles these fields with encryption. The bulk import flow already accepts them. This just closes the gap in the manual single-assignment creation flow.

**Alternatives considered**:
- Adding fields only to the assignment dialog, not the assignments list quick-create: The user detail page dialog is the primary creation point. The assignments list page also has a quick-create dialog that could benefit, but is out of scope per the spec.

## R5: Unified Assignment Detail Layout

**Decision**: Merge the "Assignment Details" read-only card (lines 248-371) and the "Edit Assignment" card (lines 374-542) in `assignment-detail-client.tsx` into a single card. For active assignments viewed by admins, each field row shows the current value with an adjacent edit control (select, input, date picker). For inactive assignments or non-admin viewers, fields are read-only.

**Rationale**: The current page shows the same information twice — once in the detail card and once in the edit form. The unified view eliminates this duplication while maintaining all functionality. The form wraps the entire card content, and the submit button lives at the bottom of the card.

**Alternatives considered**:
- Tabbed interface (View/Edit tabs): Adds UI complexity and still requires switching modes. Rejected.
- Modal-based editing: Hides context. Rejected — inline is better for this use case.
