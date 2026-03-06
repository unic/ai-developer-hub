# Implementation Plan: Professional Dashboard Theme

**Branch**: `010-pro-dashboard-theme` | **Date**: 2026-03-06 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/010-pro-dashboard-theme/spec.md`

## Summary

Replace the retro-glitch theme with a clean, professional dashboard theme using company green #a4c400 as the primary accent color. This involves updating all CSS custom property tokens in `globals.css`, removing retro-glitch utilities/animations/state management, cleaning retro class references from 3 component files, updating chart color palettes, and simplifying the appearance settings page. No new dependencies required.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (strict mode), React 19.2.4, Next.js 15.5.12 (App Router)
**Primary Dependencies**: Tailwind CSS 4.2.1, shadcn/ui (new-york), next-themes 0.4.6, Recharts 2.15.4, class-variance-authority
**Storage**: Neon PostgreSQL via Drizzle ORM (minor schema default change for UserPreferences)
**Testing**: Vitest (unit), Playwright (e2e), Lighthouse CI (performance)
**Target Platform**: Web (modern browsers)
**Project Type**: Web application (Next.js App Router)
**Performance Goals**: LCP < 2.5s, INP < 200ms, CLS < 0.1, JS bundle < 150KB gzipped per route
**Constraints**: WCAG AA contrast compliance, no new dependencies, prefers-reduced-motion respected
**Scale/Scope**: ~22 pages, 26 shadcn/ui components, 3 files with retro class references, 1 CSS file with theme tokens

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Pre-Research Gate

| Principle | Status | Notes |
| --------- | ------ | ----- |
| I. Type-Safe Code Quality | PASS | TypeScript strict mode maintained. Removing `leanMode` from UserPreferences type is a type-safe change. |
| II. UX Consistency | PASS | All styling via design tokens and shadcn/ui components. No ad-hoc styling introduced. Brand color applied consistently. |
| III. Performance Budgets | PASS | Removing JetBrains Mono font and retro CSS reduces bundle size. No new dependencies added. |
| IV. Accessibility-First | PASS | WCAG AA contrast requirements explicit in spec. Focus rings use brand green for visibility. |
| V. Simplicity & Maintainability | PASS | Net reduction in code: removing ~130 lines of retro CSS, 3 files (context, hook, toggle component), and lean-mode state management. |

### Post-Design Gate

| Principle | Status | Notes |
| --------- | ------ | ----- |
| I. Type-Safe Code Quality | PASS | UserPreferences type simplified (fewer properties). No `any` introduced. |
| II. UX Consistency | PASS | All colors via CSS custom properties consumed by Tailwind classes. No hardcoded values. Fixes existing `text-green-600` hardcode. |
| III. Performance Budgets | PASS | Net negative bundle impact — font removed, CSS reduced. No JS additions. |
| IV. Accessibility-First | PASS | All token pairs designed for AA contrast. Dark text on #a4c400 achieves ~7:1 ratio. |
| V. Simplicity & Maintainability | PASS | Removes lean-mode toggle system (context, hook, component, provider, inline script). Simplifies theme architecture. |

## Project Structure

### Documentation (this feature)

```text
specs/010-pro-dashboard-theme/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research findings
├── data-model.md        # CSS token model + schema changes
├── quickstart.md        # Setup and verification guide
├── contracts/
│   └── ui-tokens.md     # CSS token contract (added/removed/changed)
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── globals.css              # MODIFY: Theme tokens, remove retro utilities
│   ├── layout.tsx               # MODIFY: Remove font, inline script, LeanModeProvider
│   ├── page.tsx                 # MODIFY: Remove retro: classes
│   └── settings/
│       └── appearance/
│           └── page.tsx         # MODIFY: Remove retro preview/lean toggle
├── components/
│   ├── app-sidebar.tsx          # MODIFY: Remove retro: classes, lean-mode-toggle import
│   ├── lean-mode-toggle.tsx     # DELETE: No longer needed
│   └── reports/
│       └── reports-charts-panel.tsx  # MODIFY: Replace text-green-600
├── contexts/
│   └── lean-mode-context.tsx    # DELETE: No longer needed
├── hooks/
│   ├── use-lean-mode.ts         # DELETE: No longer needed
│   └── use-theme-preference.ts  # MODIFY: Remove leanMode references
├── actions/
│   └── preferences.ts           # MODIFY: Remove leanMode handling
├── types/
│   └── index.ts                 # MODIFY: Remove leanMode from UserPreferences
└── lib/
    └── db/
        └── schema.ts            # MODIFY: Update preferences default
```

**Structure Decision**: Existing Next.js App Router structure maintained. No new files created. 3 files deleted (lean-mode system), ~10 files modified (theme tokens + retro class cleanup).

## Complexity Tracking

No constitution violations. No complexity tracking needed.
