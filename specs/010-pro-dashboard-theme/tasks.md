# Tasks: Professional Dashboard Theme

**Input**: Design documents from `/specs/010-pro-dashboard-theme/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/ui-tokens.md

**Tests**: Not requested in spec — test tasks omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No setup needed — existing project, no new dependencies, no structural changes.

*(No tasks in this phase)*

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Replace the complete CSS theme definition in globals.css. This single file contains all color tokens, retro utilities, and chart colors — all three user stories depend on this file being updated first.

**CRITICAL**: globals.css is the source of truth for the entire visual theme. It must be updated before any component cleanup or chart work can proceed.

- [x] T001 Overhaul the complete theme definition in `src/app/globals.css`: (1) Remove the `@custom-variant retro` line, (2) Replace `@theme inline` block — remove phosphor color tokens (`--color-phosphor-green`, `--color-phosphor-cyan`, `--color-phosphor-magenta`, `--color-phosphor-amber`) and `--font-mono-retro`, update `--color-primary` to map to brand green oklch(0.78 0.19 120), update `--color-ring` to brand green, update `--color-chart-1` through `--color-chart-5` per research R4 palette, update `--color-sidebar-primary` and `--color-sidebar-ring` to brand green, (3) Replace `:root` light mode token values — set `--primary` to `oklch(0.78 0.19 120)`, `--primary-foreground` to `oklch(0.18 0 0)`, `--accent` to `oklch(0.95 0.03 120)`, `--ring` to `oklch(0.78 0.19 120)`, update chart-1 through chart-5 per research R4 light palette, update sidebar-primary to `oklch(0.78 0.19 120)`, update sidebar-ring to `oklch(0.78 0.19 120)`, remove `--retro: 0` variable, (4) Remove `[data-retro]` rule block, (5) Replace `.dark` mode token values — update primary/ring/accent/chart/sidebar tokens for dark mode per research R3 and R4 dark palettes, (6) Remove ALL retro utility definitions: `@utility scanlines`, `@utility noise-static`, `@utility border-glitch`, `@utility border-pixel`, `@utility neon-glow-green`, `@utility neon-glow-cyan`, `@utility neon-glow-amber`, `@utility neon-box-green`, `@utility badge-retro`, `@utility animate-flicker`, `@utility animate-glitch-border`, (7) Remove retro animation keyframes (`@keyframes flicker`, `@keyframes glitch-border`) and their `@media (prefers-reduced-motion: no-preference)` wrapper, (8) Keep the `@media (prefers-reduced-motion: reduce)` block and `@layer base` block unchanged, (9) Keep `@custom-variant dark` unchanged

**Checkpoint**: Theme tokens updated — the application should now render with brand green accent in both light and dark modes. Retro CSS utilities are no longer available.

---

## Phase 3: User Story 1 — Professional Dashboard Interface (Priority: P1)

**Goal**: The application renders with a clean professional look, brand green #a4c400 accent on interactive elements, in both light and dark modes. Theme toggle and preference persistence work.

**Independent Test**: Load the app in light and dark modes. Buttons, links, active nav items, and focus rings should use the brand green. Background should be neutral gray/white (light) or dark charcoal (dark). All text should be readable.

### Implementation for User Story 1

- [x] T002 [US1] Update `src/app/layout.tsx`: (1) Remove the JetBrains Mono font import (`import { JetBrains_Mono } from "next/font/google"`) and its `const jetbrainsMono = ...` declaration, (2) Remove the JetBrains Mono CSS variable assignment from the html className (remove the `jetbrainsMono.variable` reference), (3) Remove the inline `<script>` block that checks localStorage for "lean-mode" and sets `data-retro` attribute, (4) Remove the `LeanModeProvider` wrapper from the component tree (remove import from `@/contexts/lean-mode-context`), (5) Keep ThemeProvider, SessionProvider, SidebarProvider, and Toaster unchanged

- [x] T003 [US1] Update `src/app/page.tsx`: Remove all `retro:` class prefixes from className strings — specifically remove `retro:neon-glow-green` from the h1 element, `retro:badge-retro` from the description paragraph, and `retro:border-glitch` from Card link elements. Keep all non-retro classes intact.

- [x] T004 [P] [US1] Update `src/components/app-sidebar.tsx`: (1) Remove `retro:border-glitch` from SidebarHeader className, (2) Remove `retro:neon-glow-green` from the "AI Developer Hub" h2 className, (3) Remove `retro:badge-retro retro:text-phosphor-cyan` from the user role paragraph className, (4) Remove the import of `LeanModeToggle` from `@/components/lean-mode-toggle`, (5) Remove the `<LeanModeToggle />` component usage from the sidebar footer, (6) Keep all navigation items, theme toggle, user info, and logout button unchanged

**Checkpoint**: User Story 1 complete. App should render with professional green-accented theme in both modes. No retro classes on main pages. Theme toggle works.

---

## Phase 4: User Story 2 — Replace Retro-Glitch Aesthetic (Priority: P2)

**Goal**: All retro-glitch state management, files, and preferences are removed. The settings/appearance page shows only the theme mode selector. UserPreferences type no longer includes leanMode.

**Independent Test**: Navigate to Settings > Appearance. Only light/dark/system selector should be visible (no lean-mode toggle, no retro preview cards). Check that no retro-related code remains in the TypeScript type system.

### Implementation for User Story 2

- [x] T005 [P] [US2] Delete `src/contexts/lean-mode-context.tsx` — the LeanModeProvider and LeanModeContext are no longer used (layout.tsx import already removed in T002)

- [x] T006 [P] [US2] Delete `src/hooks/use-lean-mode.ts` — the useLeanMode hook is no longer used

- [x] T007 [P] [US2] Delete `src/components/lean-mode-toggle.tsx` — the toggle UI component is no longer used (sidebar import already removed in T004)

- [x] T008 [P] [US2] Update `src/types/index.ts`: Remove the `leanMode: boolean` property from the `UserPreferences` type. The type should become `{ theme: "light" | "dark" | "system" }`

- [x] T009 [P] [US2] Update `src/lib/db/schema.ts`: Change the preferences column default from `{ theme: "system", leanMode: false }` to `{ theme: "system" }`

- [x] T010 [US2] Update `src/actions/preferences.ts`: Remove any leanMode handling from the updatePreferences server action. If the Zod validation schema includes leanMode, remove it. Ensure the action only validates and persists the `theme` property.

- [x] T011 [US2] Update `src/hooks/use-theme-preference.ts`: Remove all references to `leanMode`, `isLean`, `setLeanMode`, and the `useLeanMode` import. The hook should only manage `theme`, `resolvedTheme`, and `setTheme`.

- [x] T012 [US2] Update `src/app/settings/appearance/page.tsx`: (1) Remove the lean-mode toggle section (LeanModeToggle component and its label/description), (2) Remove the retro preview cards that demonstrate retro effects (the cards with `retro:border-glitch retro:scanlines`, `retro:neon-glow-green`, `retro:neon-glow-cyan`, `retro:badge-retro retro:text-phosphor-cyan` classes), (3) Remove any imports of LeanModeToggle or useLeanMode, (4) Keep the theme mode selector (Light/Dark/System) fully functional, (5) Remove `retro:neon-glow-green` from the h1 element

**Checkpoint**: User Story 2 complete. All retro-glitch files deleted, preferences simplified, settings page clean. TypeScript should compile with no errors related to leanMode.

---

## Phase 5: User Story 3 — Consistent Brand Identity Across Charts (Priority: P3)

**Goal**: Chart and data visualization components use the brand green as primary series color. No hardcoded color values remain.

**Independent Test**: Navigate to Reports page. The primary data series in all charts (Trends, Utilization, Forecast) should render in brand green. The sparkline color should also use brand green.

### Implementation for User Story 3

- [x] T013 [US3] Update `src/components/reports/reports-charts-panel.tsx`: Replace the hardcoded `text-green-600` class (used for positive spend trend indicator) with `text-primary` to use the brand green token consistently

**Checkpoint**: User Story 3 complete. Charts use brand-green-anchored palette via CSS tokens (already set in T001). Hardcoded color eliminated. Note: chart component files (`trends-chart.tsx`, `utilization-chart.tsx`, `forecast-chart.tsx`, `sparkline.tsx`) reference `var(--chart-1)` etc. which are already updated to the brand palette in T001 — no changes needed in those files.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify the complete implementation works correctly

- [x] T014 Run `pnpm typecheck` to verify TypeScript compilation succeeds with no errors from the leanMode type removal and all import removals
- [x] T015 Run `pnpm lint` to verify ESLint passes with zero warnings
- [x] T016 Run `pnpm build` to verify production build succeeds (catches any missing imports, broken references, or CSS issues)
- [x] T017 Verify visual appearance: start dev server with `pnpm dev`, check light mode, dark mode, and theme toggle on the dashboard, tools, budget, reports, and settings pages

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No tasks — skip
- **Foundational (Phase 2)**: T001 — BLOCKS all user stories (CSS tokens must be in place first)
- **User Story 1 (Phase 3)**: Depends on T001 — updates layout and component classes
- **User Story 2 (Phase 4)**: Depends on T001 — removes retro system files and preferences
- **User Story 3 (Phase 5)**: Depends on T001 — chart tokens already set, fixes hardcoded color
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Depends only on T001 (foundational). No dependency on other stories.
- **User Story 2 (P2)**: Depends on T001. T005-T009 can run in parallel (different files). T010-T012 depend on T008 (type change must be in place). Can run in parallel with US1.
- **User Story 3 (P3)**: Depends on T001. Can run in parallel with US1 and US2.

### Within Each User Story

```
T001 (foundational)
├─→ T002 (layout.tsx) ──→ T003 (page.tsx)
│                         T004 (sidebar) [parallel with T003]
│
├─→ T005, T006, T007 (delete files) [all parallel]
│   T008, T009 (type/schema) [parallel with deletes]
│   ├─→ T010 (preferences action)
│   ├─→ T011 (theme-preference hook)
│   └─→ T012 (settings page)
│
└─→ T013 (chart hardcode fix) [parallel with everything above]
```

### Parallel Opportunities

**After T001 completes, maximum parallelism:**

```
Parallel batch 1: T002, T005, T006, T007, T008, T009, T013
Parallel batch 2: T003, T004, T010, T011
Parallel batch 3: T012
Sequential: T014 → T015 → T016 → T017
```

---

## Parallel Example: All Stories After Foundational

```bash
# After T001 (globals.css) is complete, launch all independent tasks:
Task: "Update layout.tsx — remove font, inline script, LeanModeProvider" (T002)
Task: "Delete lean-mode-context.tsx" (T005)
Task: "Delete use-lean-mode.ts" (T006)
Task: "Delete lean-mode-toggle.tsx" (T007)
Task: "Update UserPreferences type in types/index.ts" (T008)
Task: "Update schema.ts preferences default" (T009)
Task: "Fix hardcoded text-green-600 in reports-charts-panel.tsx" (T013)

# Then after batch 1 completes:
Task: "Clean retro classes from page.tsx" (T003)
Task: "Clean retro classes from app-sidebar.tsx" (T004)
Task: "Update preferences.ts action" (T010)
Task: "Update use-theme-preference.ts hook" (T011)

# Then after batch 2:
Task: "Update settings/appearance/page.tsx" (T012)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete T001: globals.css overhaul (foundational)
2. Complete T002-T004: Layout and component class cleanup
3. **STOP and VALIDATE**: App should render with professional green theme in both modes
4. Deploy/demo if ready — retro utilities still exist in CSS but are unused

### Incremental Delivery

1. T001 → Foundation ready (new color tokens active)
2. T002-T004 → User Story 1 complete (professional look visible)
3. T005-T012 → User Story 2 complete (retro system fully removed)
4. T013 → User Story 3 complete (chart brand consistency)
5. T014-T017 → Polish (build verification, visual review)
6. Each story adds value without breaking previous stories

### Single Developer Strategy (Recommended)

Execute tasks sequentially in ID order (T001 → T017). The entire feature is ~10 file modifications and 3 file deletions — estimated at one focused session.

---

## Notes

- T001 is by far the largest task (full CSS overhaul). All other tasks are small targeted edits or file deletions.
- The chart component files (`trends-chart.tsx`, `utilization-chart.tsx`, `forecast-chart.tsx`, `sparkline.tsx`) do NOT need modification — they reference `var(--chart-N)` tokens which are updated centrally in T001.
- The `@media (prefers-reduced-motion: reduce)` block in globals.css should be preserved even though retro animations are removed — it provides a safety net for any future animations.
- Existing database rows with `leanMode` in their preferences JSON are backward-compatible — the property is simply ignored after T008/T010.
- No new dependencies are needed. pnpm install is not required.
