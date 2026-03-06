# UI Token Contract: Professional Dashboard Theme

**Feature**: 010-pro-dashboard-theme
**Date**: 2026-03-06

## Contract

The application exposes a CSS custom property API for theming. All UI components consume these tokens via Tailwind utility classes (e.g., `bg-primary`, `text-muted-foreground`). The token contract is:

### Required Tokens (must be defined in both `:root` and `.dark`)

| Token | Type | Constraint |
| ----- | ---- | ---------- |
| `--background` | oklch color | Page background |
| `--foreground` | oklch color | Primary text, AA contrast vs background |
| `--card` | oklch color | Card surface |
| `--card-foreground` | oklch color | Card text, AA contrast vs card |
| `--popover` | oklch color | Popover surface |
| `--popover-foreground` | oklch color | Popover text, AA contrast vs popover |
| `--primary` | oklch color | Brand accent (#a4c400 equivalent) |
| `--primary-foreground` | oklch color | Text on primary, AA contrast vs primary |
| `--secondary` | oklch color | Secondary surface |
| `--secondary-foreground` | oklch color | Text on secondary |
| `--muted` | oklch color | Muted/disabled surface |
| `--muted-foreground` | oklch color | Muted text |
| `--accent` | oklch color | Hover/highlight surface |
| `--accent-foreground` | oklch color | Text on accent |
| `--destructive` | oklch color | Error/danger color |
| `--border` | oklch color | Default border |
| `--input` | oklch color | Input border |
| `--ring` | oklch color | Focus ring |
| `--chart-1` through `--chart-5` | oklch color | Data visualization palette |
| `--sidebar` | oklch color | Sidebar background |
| `--sidebar-foreground` | oklch color | Sidebar text |
| `--sidebar-primary` | oklch color | Active sidebar item |
| `--sidebar-primary-foreground` | oklch color | Active sidebar item text |
| `--sidebar-accent` | oklch color | Sidebar hover |
| `--sidebar-accent-foreground` | oklch color | Sidebar hover text |
| `--sidebar-border` | oklch color | Sidebar borders |
| `--sidebar-ring` | oklch color | Sidebar focus ring |
| `--radius` | length | Border radius base value |

### Removed Tokens (no longer provided)

| Token | Reason |
| ----- | ------ |
| `--retro` | Retro-glitch system removed |
| `--color-phosphor-green` | Retro palette removed |
| `--color-phosphor-cyan` | Retro palette removed |
| `--color-phosphor-magenta` | Retro palette removed |
| `--color-phosphor-amber` | Retro palette removed |
| `--font-mono-retro` | Retro font removed |

### Removed CSS Utilities

| Utility | Reason |
| ------- | ------ |
| `scanlines` | Retro effect removed |
| `noise-static` | Retro effect removed |
| `border-glitch` | Retro effect removed |
| `border-pixel` | Retro effect removed |
| `neon-glow-green` | Retro effect removed |
| `neon-glow-cyan` | Retro effect removed |
| `neon-glow-amber` | Retro effect removed |
| `neon-box-green` | Retro effect removed |
| `badge-retro` | Retro styling removed |
| `animate-flicker` | Retro animation removed |
| `animate-glitch-border` | Retro animation removed |

### Removed Custom Variant

| Variant | Reason |
| ------- | ------ |
| `retro` (`@custom-variant retro`) | No longer applicable |

### WCAG AA Contrast Requirements

All foreground/background pairs MUST achieve:
- Normal text (< 18pt): 4.5:1 contrast ratio
- Large text (>= 18pt or 14pt bold): 3:1 contrast ratio
- Interactive elements: 3:1 against adjacent colors

### UserPreferences Contract Change

**Before**:
```typescript
{ theme: "light" | "dark" | "system"; leanMode: boolean }
```

**After**:
```typescript
{ theme: "light" | "dark" | "system" }
```

Existing database rows with `leanMode` property are unaffected (property ignored at runtime).
