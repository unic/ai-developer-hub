# Research: Bulk Data Export (Round-Trip)

**Feature Branch**: `005-bulk-export`
**Date**: 2026-03-05

## R1: CSV Generation Strategy

**Decision**: Use manual CSV generation with RFC 4180 escaping — no external library.

**Rationale**: The existing import uses manual CSV parsing (`.split(",")` in the client forms). Since the export only needs to *generate* CSV (not parse it), manual generation is simpler and avoids a new dependency. RFC 4180 escaping is straightforward: wrap fields containing commas, quotes, or newlines in double quotes, and escape internal double quotes by doubling them.

**Alternatives considered**:
- `papaparse` library: Adds ~47KB to bundle. Overkill for generation-only; its main value is robust *parsing* of edge cases.
- `csv-stringify` (Node.js): Server-only, would work for server action approach but adds an unnecessary dependency for simple CSV output.

## R2: Export Delivery Mechanism

**Decision**: Use Next.js API Route handlers (GET endpoints) that return CSV as a streamed response with `Content-Disposition: attachment` header.

**Rationale**: Server Actions are designed for mutations (POST), not file downloads. API route handlers in Next.js App Router naturally support streaming responses and setting headers for file downloads. The client triggers the download via a simple `<a href>` link or `window.location` redirect — no complex client-side blob handling needed.

**Alternatives considered**:
- Server Action returning CSV string + client-side Blob download: Works but requires client-side JavaScript to create a Blob, generate an object URL, and trigger download. More complex and less reliable across browsers.
- Server Action with `redirect()`: Cannot set Content-Disposition headers via redirect.

**Implementation pattern**:
```
GET /api/export/assignments → CSV response with Content-Disposition header
GET /api/export/users → CSV response with Content-Disposition header
```

## R3: API Key Decryption for Export

**Decision**: Use existing `decryptApiKey()` from `src/lib/crypto.ts` to decrypt API keys during export.

**Rationale**: The function already exists and is used by the `revealApiKey()` server action in `src/actions/assignments.ts` (line 476). It handles the AES-256-GCM decryption with scrypt key derivation. No new cryptographic code needed.

**Security consideration**: Export endpoints MUST verify admin authentication before returning decrypted keys. The API route handler must call `requireAdmin()` before processing.

**Alternatives considered**:
- Export masked keys only: Would break round-trip import since masked keys aren't valid. Defeats the feature purpose.
- Export without API keys: Users would lose API key data on re-import. Could be an option but the spec requires decrypted keys (FR-004).

## R4: Database Query Strategy for Assignment Export

**Decision**: Use a single Drizzle query with joins to resolve user emails, tool names, and tier names in one database round-trip.

**Rationale**: The assignment export requires resolving 3 foreign keys (userId → email, toolId → tool name, tierId → tier name). A single query with joins is the most efficient approach, matching the pattern used in the existing assignment list page.

**Query shape**:
```
SELECT la.*, u.email, at2.name as toolName, at3.name as tierName
FROM licenseAssignments la
JOIN users u ON la.userId = u.id
JOIN aiTools at2 ON la.toolId = at2.id
JOIN accessTiers at3 ON la.tierId = at3.id
```

**Alternatives considered**:
- Separate queries + in-memory join (like bulk import uses lookup maps): More code, multiple round-trips, but familiar pattern. Not needed since we're reading, not writing.
- Raw SQL: Unnecessary — Drizzle's query builder handles joins well.

## R5: File Naming Convention

**Decision**: Use `{entity}-export-{YYYY-MM-DD}.csv` format (e.g., `assignments-export-2026-03-05.csv`).

**Rationale**: Descriptive, sortable by date, and matches the convention suggested in the spec (FR-010). Uses the server's current date (UTC) to avoid timezone ambiguity.

## R6: UTF-8 BOM for Excel Compatibility

**Decision**: Prepend UTF-8 BOM (`\uFEFF`) to CSV output for Excel compatibility.

**Rationale**: Microsoft Excel on Windows does not auto-detect UTF-8 encoding in CSV files without a BOM. Since SC-004 requires compatibility with Excel, Google Sheets, and LibreOffice Calc, adding the BOM ensures all three handle the file correctly. Google Sheets and LibreOffice ignore the BOM gracefully.

**Alternatives considered**:
- No BOM: Works for Google Sheets and LibreOffice but Excel may show garbled characters for non-ASCII data (e.g., accented names).
- Export as .xlsx: Much more complex, requires a library like `exceljs`. Overkill for this feature.
