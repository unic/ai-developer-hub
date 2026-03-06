# Quickstart: Professional Dashboard Theme

**Feature**: 010-pro-dashboard-theme
**Date**: 2026-03-06

## Prerequisites

- Node.js LTS
- pnpm installed
- Access to the repository

## Setup

```bash
# Switch to feature branch
git checkout 010-pro-dashboard-theme

# Install dependencies (no new dependencies needed)
pnpm install

# Start dev server
pnpm dev
```

## What This Feature Changes

This feature replaces the retro-glitch theme with a professional dashboard theme using company green #a4c400 as the primary accent color.

### Key Changes

1. **Color palette**: All CSS custom properties in `globals.css` updated to professional neutral palette with #a4c400 green accent
2. **Retro removal**: All retro-glitch utilities, phosphor colors, animations, and the lean-mode toggle system removed
3. **Chart colors**: Data visualization palette updated with brand green as primary series color
4. **Font cleanup**: JetBrains Mono font import removed (was only for retro badge styling)
5. **Preference schema**: `leanMode` property removed from UserPreferences

### Files to Review

- `src/app/globals.css` — Primary theme definition (color tokens)
- `src/app/layout.tsx` — Provider/font changes
- `src/components/app-sidebar.tsx` — Navigation styling
- `src/app/page.tsx` — Dashboard page
- `src/app/settings/appearance/page.tsx` — Settings page

## Verification

1. **Light mode**: Open app → verify neutral gray/white background with #a4c400 green buttons and active states
2. **Dark mode**: Toggle to dark → verify dark background with green accent preserved
3. **Theme toggle**: Switch light/dark/system → verify preference persists on refresh
4. **Charts**: Navigate to Reports → verify brand green is primary chart color
5. **No retro artifacts**: Browse all pages → confirm no scanlines, neon glows, or glitch effects
6. **Contrast**: Check text readability in both modes (WCAG AA)

## Testing

```bash
pnpm typecheck    # Verify no type errors from schema changes
pnpm lint         # Verify no lint warnings
pnpm test         # Run unit tests
pnpm build        # Verify production build succeeds
```
