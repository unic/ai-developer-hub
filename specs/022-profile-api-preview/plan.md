# Implementation Plan: Profile API Preview

**Branch**: `022-profile-api-preview` | **Date**: 2026-03-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/022-profile-api-preview/spec.md`

## Summary

Add an "API Preview" section to the Settings area that lets administrators test the profile API endpoint in-browser. The section provides input fields for `email` (required) and `month` (optional), calls the real `/api/profile` endpoint with Bearer token auth via a server action, and displays the JSON response with syntax highlighting, status code, response time, copy-to-clipboard, and collapsible sections.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode)
**Primary Dependencies**: Next.js 15.5.12 (App Router), React 19.2.4, shadcn/ui (new-york), Zod 4.3.6, Sonner (toasts), Lucide React
**Storage**: N/A — no schema changes, read-only against existing profile API
**Testing**: Vitest (unit), Playwright (e2e)
**Target Platform**: Web (Next.js deployed on Vercel)
**Project Type**: Web application (Next.js App Router)
**Performance Goals**: Response rendering < 100ms after API returns; JSON viewer handles payloads up to 500KB without jank
**Constraints**: Bearer token must never be exposed to client; server action proxies the API call
**Scale/Scope**: Admin-only feature, low traffic (< 10 concurrent users)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type-Safe Code Quality | PASS | All new code in TypeScript strict mode. Server action return types follow existing `ActionResult<T>` pattern. Zod validation for inputs. |
| II. UX Consistency | PASS | Uses shadcn/ui Card, Input, Button, Badge components. Design tokens only. Loading/error/empty states defined. |
| III. Performance Budgets | PASS | Single settings sub-page, minimal JS. No heavy dependencies — JSON syntax highlighting done with lightweight custom component using Tailwind classes. |
| IV. Accessibility-First | PASS | Form inputs with labels, keyboard-navigable collapsible sections, color not sole indicator of status (Badge text + icon), focus management on submit. |
| V. Simplicity & Maintainability | PASS | No new dependencies. Custom JSON viewer using recursive React component (~100 lines). Server action is a thin fetch wrapper. No abstractions beyond what's needed. |

## Project Structure

### Documentation (this feature)

```text
specs/022-profile-api-preview/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── app/
│   └── settings/
│       ├── settings-nav.tsx          # MODIFY: Add "API Preview" tab to adminTabs
│       └── api-preview/
│           └── page.tsx              # NEW: Server component — auth gate + render client
├── components/
│   ├── settings/
│   │   └── api-preview-client.tsx    # NEW: Client component — form, submit, response display
│   └── ui/
│       └── json-viewer.tsx           # NEW: Recursive collapsible JSON viewer with syntax highlighting
├── actions/
│   └── profile-api-preview.ts       # NEW: Server action — fetch /api/profile with Bearer token
└── lib/
    └── validators.ts                 # MODIFY: Export existing email/month schemas if not already exported
```

**Structure Decision**: Follows the established settings page pattern — server component page for auth gating, client component for interactivity, server action for data fetching. JSON viewer is a reusable UI component placed alongside other shadcn/ui components.

## Complexity Tracking

No constitution violations. No complexity justifications needed.
