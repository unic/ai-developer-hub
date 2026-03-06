# Data Model: Professional Dashboard Theme

**Feature**: 010-pro-dashboard-theme
**Date**: 2026-03-06

## Entities

### Theme Configuration (CSS Custom Properties)

The theme is defined entirely via CSS custom properties. No database tables are created or modified for the theme itself.

**Light Mode Token Set** (`:root`):

| Token | Role | Value (oklch) |
| ----- | ---- | ------------- |
| --background | Page background | ~1.0 0 0 (white) |
| --foreground | Primary text | ~0.15 0 0 (dark charcoal) |
| --card | Card surfaces | ~1.0 0 0 (white) |
| --card-foreground | Card text | ~0.15 0 0 |
| --popover | Popover surfaces | ~1.0 0 0 |
| --popover-foreground | Popover text | ~0.15 0 0 |
| --primary | Brand accent (#a4c400) | 0.78 0.19 120 |
| --primary-foreground | Text on primary | ~0.18 0 0 (dark) |
| --secondary | Secondary surfaces | ~0.96 0 0 (light gray) |
| --secondary-foreground | Text on secondary | ~0.20 0 0 |
| --muted | Muted surfaces | ~0.96 0 0 |
| --muted-foreground | Muted/disabled text | ~0.55 0 0 |
| --accent | Hover/highlight | ~0.95 0.03 120 (faint green tint) |
| --accent-foreground | Text on accent | ~0.20 0 0 |
| --destructive | Error/danger | ~0.58 0.25 27 (red) |
| --border | Borders | ~0.91 0 0 (light gray) |
| --input | Input borders | ~0.91 0 0 |
| --ring | Focus rings | 0.78 0.19 120 (brand green) |
| --chart-1 | Primary chart color | 0.78 0.19 120 (brand green) |
| --chart-2 | Secondary chart color | 0.55 0.15 250 (blue) |
| --chart-3 | Tertiary chart color | 0.65 0.18 45 (amber) |
| --chart-4 | Quaternary chart color | 0.50 0.15 300 (purple) |
| --chart-5 | Quinary chart color | 0.60 0.12 180 (teal) |
| --sidebar | Sidebar background | ~0.98 0 0 |
| --sidebar-foreground | Sidebar text | ~0.15 0 0 |
| --sidebar-primary | Active nav item | 0.78 0.19 120 (brand green) |
| --sidebar-primary-foreground | Active nav text | ~0.18 0 0 |
| --sidebar-accent | Sidebar hover | ~0.96 0 0 |
| --sidebar-accent-foreground | Sidebar hover text | ~0.20 0 0 |
| --sidebar-border | Sidebar borders | ~0.91 0 0 |
| --sidebar-ring | Sidebar focus ring | 0.78 0.19 120 |

**Dark Mode Token Set** (`.dark`):

Same token names, adjusted for dark backgrounds. Key differences:
- Background/card: dark charcoal (~0.16 / ~0.21)
- Foreground: light (~0.97-0.98)
- Primary: brand green (may increase lightness slightly for visibility)
- Primary-foreground: dark text on green buttons
- Borders: subtle white opacity (~10-15%)
- Chart colors: slightly brighter variants

### UserPreferences (Schema Change)

**Current**:
```typescript
type UserPreferences = {
  theme: "light" | "dark" | "system";
  leanMode: boolean;
};
```

**Updated**:
```typescript
type UserPreferences = {
  theme: "light" | "dark" | "system";
};
```

- `leanMode` property removed
- Database default updated from `{ theme: "system", leanMode: false }` to `{ theme: "system" }`
- Backward compatible: existing rows with `leanMode` property are unaffected (JSON property simply unused)

## Files Removed

| File | Reason |
| ---- | ------ |
| `src/contexts/lean-mode-context.tsx` | Retro toggle context no longer needed |
| `src/hooks/use-lean-mode.ts` | Retro toggle hook no longer needed |
| `src/components/lean-mode-toggle.tsx` | Retro toggle UI no longer needed |

## Files Modified

| File | Change |
| ---- | ------ |
| `src/app/globals.css` | Replace theme tokens, remove retro utilities/phosphor colors/animations |
| `src/app/layout.tsx` | Remove JetBrains Mono font, inline retro script, LeanModeProvider |
| `src/components/app-sidebar.tsx` | Remove `retro:` classes, remove lean-mode-toggle import |
| `src/app/page.tsx` | Remove `retro:` classes |
| `src/app/settings/appearance/page.tsx` | Remove retro preview, lean-mode toggle |
| `src/types/index.ts` | Remove `leanMode` from UserPreferences |
| `src/lib/db/schema.ts` | Update preferences default |
| `src/actions/preferences.ts` | Remove leanMode handling |
| `src/hooks/use-theme-preference.ts` | Remove leanMode references |
| `src/components/reports/reports-charts-panel.tsx` | Replace `text-green-600` with `text-primary` |
