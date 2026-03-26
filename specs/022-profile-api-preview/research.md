# Research: Profile API Preview

**Feature**: 022-profile-api-preview
**Date**: 2026-03-26

## R1: JSON Syntax Highlighting Approach

**Decision**: Custom lightweight JSON viewer component using Tailwind CSS classes for syntax coloring — no external library.

**Rationale**: The project has no existing syntax highlighting library (no Prism, Highlight.js, or react-syntax-highlighter). Adding one would increase bundle size (Prism ~30KB, react-syntax-highlighter ~100KB+ with languages). Since we only need to highlight JSON (not arbitrary languages), a custom recursive React component that renders keys, strings, numbers, booleans, and nulls with different Tailwind color classes is sufficient and keeps bundle impact at zero new dependencies.

**Alternatives considered**:
- `react-syntax-highlighter`: Heavy dependency, overkill for JSON-only use case.
- `prismjs` + manual integration: Still adds bundle weight and requires theme CSS.
- `JSON.stringify` with `<pre>` tag: No interactivity (no collapsing), poor UX for large payloads.

## R2: Server Action vs. API Route for Preview Requests

**Decision**: Server action that calls the profile API endpoint internally using `fetch()`.

**Rationale**: The spec requires calling the *real* API endpoint (not a simulation). A server action keeps the Bearer token server-side (never exposed to the client) while still hitting the actual `/api/profile` route. This follows the existing pattern where server actions perform privileged operations. The base URL is constructed using the established `NEXTAUTH_URL || VERCEL_URL || localhost:3000` pattern found in `src/lib/invite.ts`.

**Alternatives considered**:
- Direct database query via `fetchProfileDataInternal()`: Would bypass the API entirely — contradicts the spec requirement to test the *real API*.
- Client-side fetch with token in header: Would expose the Bearer token to the browser — security violation.
- Dedicated API route `/api/preview-profile`: Unnecessary extra route when a server action accomplishes the same goal more simply.

## R3: Collapsible JSON Sections

**Decision**: Custom collapsible tree built into the JSON viewer component using React state per node, toggled by clicking the key name or a chevron icon.

**Rationale**: The shadcn/ui library includes a `Collapsible` component (from Radix UI) but it's designed for single open/close sections, not nested tree structures. A custom approach with `useState` per object/array node is simpler and avoids wrapping every JSON node in a Radix primitive. Chevron icons from Lucide React (ChevronRight/ChevronDown) provide clear affordance.

**Alternatives considered**:
- shadcn/ui Collapsible per node: Heavy DOM overhead for deeply nested JSON, awkward nesting of Radix providers.
- Third-party JSON tree viewer (react-json-view, react-json-tree): Adds dependency, styling may conflict with design system.

## R4: Settings Navigation Integration

**Decision**: Add "API Preview" to the `adminTabs` array in `src/app/settings/settings-nav.tsx`.

**Rationale**: The settings nav already splits tabs into `baseTabs` (all users) and `adminTabs` (admin-only). Adding a new entry to `adminTabs` follows the established pattern and automatically hides the tab from non-admin users. The page component will also call `requireAdmin()` as a server-side gate, matching the pattern in `integrations/page.tsx` and `sync/page.tsx`.

**Alternatives considered**:
- Separate admin panel outside settings: Would break the established UX pattern and add navigation complexity.
- Feature flag: Unnecessary for an admin-only tool with clear access control already in place.

## R5: Response Time Measurement

**Decision**: Measure elapsed time in the server action using `performance.now()` before and after the `fetch()` call, returning the delta in milliseconds alongside the response.

**Rationale**: This gives accurate server-side timing that includes network latency to the API endpoint but excludes client rendering time. The `performance.now()` API is available in Node.js and provides sub-millisecond precision.

**Alternatives considered**:
- Client-side timing: Would include server action overhead + serialization, not representative of actual API performance.
- Response headers (e.g., `Server-Timing`): The profile API doesn't currently emit timing headers.
