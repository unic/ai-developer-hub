# Tasks: Retro-Glitch Theme System

**Input**: Design documents from `/specs/002-retro-glitch-themes/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contracts.md, quickstart.md

**Tests**: Not explicitly requested in the feature specification. Test tasks are omitted. Manual verification via quickstart.md scenarios in the Polish phase.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Define shared types and validation schemas used across all user stories

- [X] T001 [P] Add UserPreferences type (`theme: "light" | "dark" | "system"`, `leanMode: boolean`) and ActionResult generic to `src/types/index.ts`
- [X] T002 [P] Add Zod validation schema `userPreferencesSchema` with `z.enum(["light","dark","system"])` and `z.boolean()` to `src/lib/validators.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**CRITICAL**: No user story work can begin until this phase is complete

- [X] T003 [P] Fix Tailwind v4 dark variant selector from `(&:is(.dark *))` to `(&:where(.dark, .dark *))` in `src/app/globals.css`
- [X] T004 [P] Add `preferences` JSONB column with default `'{"theme":"system","leanMode":false}'` to users table schema using `.$type<UserPreferences>()` in `src/lib/db/schema.ts`
- [X] T005 Generate and apply database migration for the new preferences column via `pnpm db:generate && pnpm db:migrate`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Switch Between Dark and Light Themes (Priority: P1) MVP

**Goal**: Users can toggle between dark, light, and system themes with instant transitions, no FOUC, and persistent preference via localStorage

**Independent Test**: Click the theme toggle in the sidebar footer, verify entire UI switches between dark/light with no flash. Refresh the page and confirm the preference persists. Verify first visit respects OS color scheme.

### Implementation for User Story 1

- [X] T006 [P] [US1] Create ThemeProvider `"use client"` wrapper component that passes `attribute="class"`, `defaultTheme="system"`, `enableSystem`, and `disableTransitionOnChange` to NextThemesProvider in `src/components/theme-provider.tsx`
- [X] T007 [P] [US1] Create ThemeToggle component with shadcn/ui Button (ghost/icon) trigger showing Sun/Moon icons, DropdownMenu with Light/Dark/System options, `aria-label="Toggle theme"`, and a `mounted` guard to prevent hydration mismatch in `src/components/theme-toggle.tsx`
- [X] T008 [US1] Integrate ThemeProvider into root layout: add `suppressHydrationWarning` to `<html>` tag, wrap children with `<ThemeProvider>`, ensure `<Toaster />` is inside the provider in `src/app/layout.tsx`
- [X] T009 [US1] Add ThemeToggle component to the sidebar footer area in `src/components/app-sidebar.tsx`

**Checkpoint**: User Story 1 is fully functional — dark/light/system theme switching works across all pages with localStorage persistence

---

## Phase 4: User Story 2 - Experience Retro-Glitch Visual Aesthetic (Priority: P2)

**Goal**: Application displays a distinctive retro-digital aesthetic with scanlines, noise textures, glitch borders, neon accents, and phosphor colors that work in both dark and light themes and respect `prefers-reduced-motion`

**Independent Test**: Navigate through key pages in both dark and light themes. Verify scanline overlays, neon accent colors, glitch borders, and monospace badge typography are visible. Enable `prefers-reduced-motion` in OS settings and verify all animated effects are disabled.

### Implementation for User Story 2

- [ ] T010 [P] [US2] Configure JetBrains Mono font via `next/font/google` with `{ subsets: ["latin"], variable: "--font-mono-retro" }` and add the CSS variable class to the `<html>` element in `src/app/layout.tsx`
- [ ] T011 [P] [US2] Add retro-glitch design tokens to `@theme` block (phosphor-green `oklch(0.86 0.29 142)`, phosphor-cyan `oklch(0.91 0.19 196)`, phosphor-magenta `oklch(0.70 0.32 328)`, phosphor-amber `oklch(0.82 0.19 72)`, `--font-mono-retro`), define `--retro: 0` on `:root` and `--retro: 1` on `[data-retro]`, and add `@custom-variant retro (&:where([data-retro], [data-retro] *))` in `src/app/globals.css`
- [ ] T012 [US2] Implement retro utility classes via `@utility` in `src/app/globals.css`: `scanlines` (repeating-linear-gradient `::after` with opacity `calc(var(--retro) * 0.12)`), `noise-static` (SVG feTurbulence `::before` with opacity `calc(var(--retro) * 0.06)`), `border-glitch` (double offset box-shadow in cyan/magenta), `border-pixel` (stepped gradient border-image), `neon-glow-green`/`neon-glow-cyan`/`neon-glow-amber` (layered text-shadow), `neon-box-green` (box-shadow with inner glow), `badge-retro` (monospace uppercase letter-spacing)
- [ ] T013 [US2] Add retro keyframe animations (`animate-flicker` brightness flicker, `animate-glitch-border` chromatic aberration shift) wrapped in `@media (prefers-reduced-motion: no-preference)` and add global reduced-motion kill-switch (`animation-duration: 1ms !important`) in `src/app/globals.css`
- [ ] T014 [US2] Apply retro-glitch effects to key application UI surfaces using the new utility classes and `retro:` variant (sidebar borders, card headers, page title decorations, badge elements) across existing component files

**Checkpoint**: User Story 2 is fully functional — retro-glitch aesthetic visible in both dark and light modes, all effects respect `prefers-reduced-motion`

---

## Phase 5: User Story 3 - Toggle Lean UI Mode (Priority: P3)

**Goal**: Users can toggle lean mode to remove all decorative retro-glitch effects while preserving full functionality, with preference persisted via localStorage

**Independent Test**: Toggle lean mode ON in the sidebar footer — all scanlines, noise textures, glitch borders, and neon effects disappear. Verify all features remain functional. Toggle OFF — all effects return immediately. Switch themes in lean mode — interface adapts correctly without retro elements reappearing. Refresh — preference persists.

### Implementation for User Story 3

- [ ] T015 [US3] Create LeanModeProvider `"use client"` context that manages `data-retro` attribute on `document.documentElement`, reads initial value from `localStorage` key `"lean-mode"`, defaults to `false` (retro ON), and exposes `{ isLean, setLeanMode }` via context in `src/contexts/lean-mode-context.tsx`
- [ ] T016 [US3] Create `useLeanMode` convenience hook that consumes LeanModeContext and throws if used outside LeanModeProvider in `src/hooks/use-lean-mode.ts`
- [ ] T017 [P] [US3] Add LeanModeProvider to root layout wrapping children (inside ThemeProvider), and add anti-FOUC inline script that reads `localStorage` and sets `data-retro` attribute before first paint in `src/app/layout.tsx`
- [ ] T018 [P] [US3] Create LeanModeToggle component with shadcn/ui Switch, label text "Lean Mode", and `aria-label="Toggle lean mode"` using `useLeanMode()` hook in `src/components/lean-mode-toggle.tsx`
- [ ] T019 [US3] Add LeanModeToggle component to the sidebar footer (alongside ThemeToggle) in `src/components/app-sidebar.tsx`

**Checkpoint**: User Story 3 is fully functional — lean mode toggles all retro effects on/off, works independently in dark and light themes, preference persists

---

## Phase 6: User Story 4 - Customize Theme from Settings Page (Priority: P4)

**Goal**: Dedicated appearance settings page consolidates theme and lean mode controls with live preview. Authenticated users get server-side persistence via JSONB preferences column with JWT integration.

**Independent Test**: Navigate to Settings > Appearance. Verify current theme and lean mode status displayed. Change settings and observe live preview. Save, navigate away, return — preferences preserved. Log in and verify preferences sync across tabs/devices.

### Implementation for User Story 4

- [ ] T020 [P] [US4] Create `updatePreferences` server action that validates input with `userPreferencesSchema`, requires authenticated session, updates `users.preferences` JSONB column and `updatedAt` timestamp, returns `ActionResult<UserPreferences>` in `src/actions/preferences.ts`
- [ ] T021 [P] [US4] Extend NextAuth JWT callback to embed `preferences` from DB at sign-in, extend session callback to expose `preferences` on `session.user`, handle `trigger === "update"` for preference changes in `src/lib/auth.ts`
- [ ] T022 [US4] Create `useThemePreference` combined hook wrapping `useTheme()` and `useLeanMode()`, calling `updatePreferences()` server action on change for authenticated users, refreshing JWT via `useSession().update()`, with rollback on failure and `isSaving` loading state in `src/hooks/use-theme-preference.ts`
- [ ] T023 [P] [US4] Upgrade ThemeToggle and LeanModeToggle components to use `useThemePreference` hook so changes persist via server action for authenticated users in `src/components/theme-toggle.tsx` and `src/components/lean-mode-toggle.tsx`
- [ ] T024 [P] [US4] Create appearance settings page with current theme selector (dark/light/system), lean mode switch, live preview panel showing all four combinations, and save confirmation in `src/app/settings/appearance/page.tsx`

**Checkpoint**: User Story 4 is fully functional — settings page works, server persistence active for authenticated users, preferences sync across sessions

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Validate all four appearance combinations and cross-cutting quality requirements

- [ ] T025 [P] Verify WCAG AA contrast ratios (4.5:1 normal text, 3:1 large text) across all four combinations (dark-full, dark-lean, light-full, light-lean)
- [ ] T026 [P] Verify `prefers-reduced-motion: reduce` disables all animated retro-glitch effects (flicker, glitch-border) and global kill-switch works
- [ ] T027 Test theme and lean mode preference persistence: localStorage for unauthenticated users, server-side for authenticated users, server wins on login
- [ ] T028 Run full quickstart.md validation scenarios for all four appearance combinations across key pages

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 (dark variant fix needed for dark mode)
- **US2 (Phase 4)**: Depends on Phase 2 (dark variant fix, theme tokens). Logically after US1 (retro effects need theme system) but technically independent
- **US3 (Phase 5)**: Depends on Phase 2. Soft dependency on US2 (lean mode removes retro effects — testing requires effects to exist)
- **US4 (Phase 6)**: Depends on US1 + US3 (upgrades both toggles for server persistence)
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational — no dependency on other stories
- **User Story 2 (P2)**: Can start after Foundational — best sequenced after US1 for testing both themes
- **User Story 3 (P3)**: Can start after Foundational — soft dependency on US2 (effects must exist to verify removal)
- **User Story 4 (P4)**: Depends on US1 and US3 completion (upgrades their toggle components)

### Within Each User Story

- Shared types/validation from Setup phase are available
- New files (components, hooks, contexts) before layout/sidebar integration
- Core logic before UI integration
- Independent verification at each checkpoint

### Parallel Opportunities

- **Phase 1**: T001 and T002 run in parallel (different files)
- **Phase 2**: T003 and T004 run in parallel (different files); T005 depends on T004
- **Phase 3 (US1)**: T006 and T007 run in parallel (both new component files); T008 depends on T006; T009 depends on T007
- **Phase 4 (US2)**: T010 and T011 run in parallel (layout.tsx vs globals.css); T012, T013 sequential (same file after T011); T014 after T012+T013
- **Phase 5 (US3)**: T015, T016 sequential (hook depends on context); T017 and T018 run in parallel after T016 (layout.tsx vs new component); T019 after T018
- **Phase 6 (US4)**: T020 and T021 run in parallel (different files); T022 after both; T023 and T024 run in parallel after T022 (different files)
- **Phase 7**: T025 and T026 run in parallel; T027 and T028 sequential (full validation)

---

## Parallel Example: User Story 1

```
# Launch both new component files in parallel:
Task T006: "Create ThemeProvider wrapper in src/components/theme-provider.tsx"
Task T007: "Create ThemeToggle dropdown in src/components/theme-toggle.tsx"

# Then integrate sequentially:
Task T008: "Integrate ThemeProvider into root layout" (needs T006)
Task T009: "Add ThemeToggle to sidebar footer" (needs T007)
```

## Parallel Example: User Story 3

```
# Create context and hook sequentially (hook depends on context):
Task T015: "Create LeanModeProvider context"
Task T016: "Create useLeanMode hook" (needs T015)

# Then layout integration and toggle component in parallel:
Task T017: "Add LeanModeProvider to layout" (needs T015)
Task T018: "Create LeanModeToggle component" (needs T016)

# Then sidebar integration:
Task T019: "Add LeanModeToggle to sidebar" (needs T018)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (types + validators)
2. Complete Phase 2: Foundational (dark variant fix, DB schema, migration)
3. Complete Phase 3: User Story 1 (ThemeProvider, ThemeToggle, layout + sidebar integration)
4. **STOP and VALIDATE**: Toggle dark/light/system, verify no FOUC, verify persistence
5. Deploy/demo if ready — users can switch themes

### Incremental Delivery

1. Setup + Foundational -> Foundation ready
2. Add User Story 1 -> Test independently -> Deploy (MVP: theme switching)
3. Add User Story 2 -> Test independently -> Deploy (retro-glitch aesthetic live)
4. Add User Story 3 -> Test independently -> Deploy (lean mode opt-out available)
5. Add User Story 4 -> Test independently -> Deploy (settings page + server persistence)
6. Polish phase -> Final validation across all four combinations

### Recommended Sequence (Single Developer)

```
Phase 1 (Setup) ─> Phase 2 (Foundation) ─> Phase 3 (US1/MVP)
                                            ├─> Phase 4 (US2: retro CSS)
                                            │   └─> Phase 5 (US3: lean mode)
                                            │       └─> Phase 6 (US4: settings + persistence)
                                            └─> Phase 7 (Polish)
```

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable at its checkpoint
- `next-themes` handles localStorage theme persistence automatically — no custom code for US1
- All retro-glitch effects use CSS `calc(var(--retro) * value)` so they collapse to zero when lean mode is active
- The four appearance combinations (dark-full, dark-lean, light-full, light-lean) multiply visual test cases
- Commit after each task or logical group
- Stop at any checkpoint to validate the story independently
