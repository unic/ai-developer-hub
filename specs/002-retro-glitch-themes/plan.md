# Implementation Plan: Retro-Glitch Theme System

**Branch**: `002-retro-glitch-themes` | **Date**: 2026-03-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-retro-glitch-themes/spec.md`

## Summary

Implement a dual-axis appearance system for the AI Developer Hub: a dark/light theme toggle powered by `next-themes` (already installed but unconfigured) and a retro-glitch visual aesthetic layer with a "Lean Mode" opt-out. The system uses Tailwind CSS v4 custom properties (already defining light/dark palettes) extended with retro-glitch design tokens (neon accent colors, scanline textures, glitch borders). A React context manages lean mode state, persisted via `localStorage` for unauthenticated users and the existing user preferences model for authenticated users. Four appearance combinations are supported: dark-full, dark-lean, light-full, light-lean.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode), React 19, Node.js LTS
**Primary Dependencies**: Next.js 15.5.12 (App Router), Tailwind CSS 4.2.1, shadcn/ui (new-york style), next-themes 0.4.6, Lucide React 0.576.0, class-variance-authority
**Storage**: Neon PostgreSQL via Drizzle ORM (user preferences), localStorage (unauthenticated preference fallback)
**Testing**: Vitest (unit/integration), Playwright (e2e), Lighthouse CI
**Target Platform**: Modern web browsers (Chrome, Firefox, Safari, Edge — current and previous major versions)
**Project Type**: Web application (Next.js App Router with server components and server actions)
**Performance Goals**: Theme/mode transitions < 300ms, no FOUC (flash of unstyled content), LCP < 2.5s, INP < 200ms, initial JS bundle per route < 150 KB gzipped
**Constraints**: WCAG AA contrast ratios in all four combinations, `prefers-reduced-motion` respect, no full page reloads on theme/mode switch
**Scale/Scope**: ~15 existing pages/routes, ~25 shadcn/ui components, 2 custom components

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
| --------- | ------ | ----- |
| I. Type-Safe Code Quality | PASS | All new code will be TypeScript strict. Theme/mode context will export typed interfaces. New hooks will have typed return values. |
| II. UX Consistency | PASS | All UI changes use shadcn/ui primitives and Tailwind design tokens. Retro-glitch styling applied via CSS custom properties and utility classes — no ad-hoc inline styles. Theme toggle uses existing shadcn/ui Button and DropdownMenu components. |
| III. Performance Budgets | PASS | `next-themes` is ~2KB gzipped. Lean mode context is trivial. Retro-glitch effects are pure CSS (no JS runtime cost). Scanline/noise textures will be small SVG data URIs or CSS-only patterns. No new third-party dependencies needed beyond what's already installed. |
| IV. Accessibility-First | PASS | Feature directly addresses accessibility: WCAG AA contrast in all combos, `prefers-reduced-motion` support, keyboard-navigable toggles with ARIA labels. Lean mode itself is an accessibility feature. |
| V. Simplicity & Maintainability | PASS | Uses `next-themes` (already installed, industry standard for Next.js theming). Lean mode is a single boolean context — no complex state machine. Retro-glitch effects use CSS custom properties that cleanly zero out in lean mode. No new dependencies required. |

**Gate Result**: ALL PASS — no violations, no complexity tracking entries needed.

## Project Structure

### Documentation (this feature)

```text
specs/002-retro-glitch-themes/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── ui-contracts.md  # UI component contracts
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── globals.css              # MODIFY: extend with retro-glitch design tokens, lean mode overrides
│   ├── layout.tsx               # MODIFY: wrap with ThemeProvider from next-themes, add LeanModeProvider
│   └── settings/
│       └── appearance/
│           └── page.tsx         # NEW: appearance settings page
├── components/
│   ├── ui/
│   │   └── (existing shadcn)   # NO CHANGES to existing shadcn/ui components
│   ├── app-sidebar.tsx          # MODIFY: add theme toggle and lean mode toggle to sidebar footer
│   ├── theme-toggle.tsx         # NEW: dark/light/system theme toggle button
│   └── lean-mode-toggle.tsx     # NEW: lean mode on/off toggle switch
├── contexts/
│   └── lean-mode-context.tsx    # NEW: React context for lean mode state
├── hooks/
│   ├── use-mobile.ts            # EXISTING: no changes
│   ├── use-theme-preference.ts  # NEW: hook for theme + lean mode preference persistence
│   └── use-lean-mode.ts         # NEW: convenience hook wrapping lean mode context
├── lib/
│   ├── db/
│   │   └── schema.ts           # MODIFY: add appearance preferences to user model
│   └── utils.ts                # EXISTING: no changes
├── actions/
│   └── preferences.ts          # NEW: server actions for persisting appearance preferences
└── types/
    └── index.ts                # MODIFY: add theme and lean mode types
```

**Structure Decision**: Single web application structure (existing). No new top-level directories needed beyond `src/contexts/` for the lean mode React context. The feature integrates into the existing layout and component hierarchy.
