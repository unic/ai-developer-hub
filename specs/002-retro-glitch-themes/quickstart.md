# Quickstart: Retro-Glitch Theme System

**Feature Branch**: `002-retro-glitch-themes`
**Date**: 2026-03-03

## Prerequisites

- Node.js LTS (v20+)
- pnpm installed
- Neon PostgreSQL database accessible
- `.env.local` configured with `DATABASE_URL` and `NEXTAUTH_SECRET`

## Setup

```bash
# Switch to feature branch
git checkout 002-retro-glitch-themes

# Install dependencies (no new packages needed — next-themes already installed)
pnpm install

# Generate and apply DB migration for new preferences column
pnpm db:generate
pnpm db:migrate

# Start dev server
pnpm dev
```

## Verify Installation

### 1. Theme Toggle (P1)
1. Log in to the application
2. Look for the Sun/Moon icon button in the sidebar footer
3. Click to open the dropdown — choose Dark, Light, or System
4. Verify: entire UI switches theme with no flash or unstyled content
5. Refresh the page — theme preference persists

### 2. Retro-Glitch Aesthetic (P2)
1. With the default settings (retro mode ON), navigate to any page
2. Look for: subtle scanline overlay on the main content area, neon accent colors on primary elements, monospace typography on badges/labels
3. In dark mode: effects should use bright phosphor colors (green, cyan)
4. In light mode: effects should use softer, muted variants

### 3. Lean Mode (P3)
1. Find the "Lean Mode" switch in the sidebar footer
2. Toggle it ON — all retro effects (scanlines, noise, glitch borders) should disappear
3. Verify: all features still work, layout is intact, just cleaner
4. Toggle it OFF — retro effects return immediately
5. Refresh — preference persists

### 4. Appearance Settings (P4)
1. Navigate to Settings > Appearance
2. Verify: current theme and lean mode status displayed
3. Change a setting — live preview reflects the change
4. Save and navigate away — preferences preserved

## Key Files

| File | Purpose |
| ---- | ------- |
| `src/app/globals.css` | Theme tokens, retro effects CSS, utility classes |
| `src/app/layout.tsx` | ThemeProvider + LeanModeProvider wrappers |
| `src/components/theme-provider.tsx` | `"use client"` wrapper for next-themes |
| `src/components/theme-toggle.tsx` | Dark/Light/System dropdown button |
| `src/components/lean-mode-toggle.tsx` | Lean mode switch |
| `src/contexts/lean-mode-context.tsx` | React context for lean mode state |
| `src/hooks/use-lean-mode.ts` | Convenience hook for lean mode |
| `src/hooks/use-theme-preference.ts` | Combined theme + lean mode hook with persistence |
| `src/actions/preferences.ts` | Server action for DB persistence |
| `src/lib/db/schema.ts` | Updated with preferences JSONB column |
| `src/lib/auth.ts` | Updated JWT/session callbacks for preferences |
| `src/lib/validators.ts` | Zod schema for preferences validation |

## Testing the Four Combinations

| # | Theme | Mode | What to Check |
| - | ----- | ---- | ------------- |
| 1 | Light | Full (retro ON) | Soft scanlines, muted neon accents, noise texture visible |
| 2 | Light | Lean | Clean light interface, no decorative effects |
| 3 | Dark | Full (retro ON) | Bright phosphor colors, scanlines prominent, neon glows active |
| 4 | Dark | Lean | Clean dark interface, no decorative effects |

For each combination, verify:
- [ ] Text is readable (WCAG AA contrast)
- [ ] All interactive elements are visible and functional
- [ ] No layout breakage or missing styles
- [ ] Navigation, forms, tables, charts all render correctly

## Development Notes

- **Adding retro effects to new components**: Use `retro:` Tailwind variant for conditional styling. Example: `retro:border-phosphor-green retro:shadow-neon-box-green`
- **Respecting lean mode in new CSS**: Multiply any decorative opacity by `var(--retro)` via `calc()`. This automatically zeroes out in lean mode.
- **Testing theme changes**: The four combinations multiply test cases. Consider visual regression tests for critical pages.
- **Font loading**: JetBrains Mono is loaded via `next/font/google` — no external requests to Google Fonts.
