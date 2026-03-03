# UI Contracts: Retro-Glitch Theme System

**Feature Branch**: `002-retro-glitch-themes`
**Date**: 2026-03-03

## Component Contracts

### ThemeProvider

**Location**: `src/components/theme-provider.tsx`
**Type**: Client component (`"use client"`)
**Purpose**: Wraps the application to provide theme context from `next-themes`.

**Props**: Passthrough to `NextThemesProvider` from `next-themes`:
- `attribute`: `"class"` (adds `.dark` class to `<html>`)
- `defaultTheme`: `"system"`
- `enableSystem`: `true`
- `disableTransitionOnChange`: `true` (prevents animation during theme switch)

**Behavior**:
- Injects blocking inline script that reads `localStorage` and applies `.dark` class before first paint
- Provides `useTheme()` hook to all descendants
- Must wrap all components that need theme awareness (including `<Toaster />`)

---

### ThemeToggle

**Location**: `src/components/theme-toggle.tsx`
**Type**: Client component (`"use client"`)
**Purpose**: Dropdown button for switching between Light, Dark, and System themes.

**Props**: None

**Rendered output**:
- `Button` (variant: `"ghost"`, size: `"icon"`) as dropdown trigger
- Sun icon (visible in light mode, hidden in dark)
- Moon icon (hidden in light mode, visible in dark)
- `DropdownMenu` with three items: Light, Dark, System
- `aria-label="Toggle theme"` on trigger button
- `sr-only` label "Toggle theme" for screen readers

**Behavior**:
- Renders a placeholder button before mount (prevents hydration mismatch)
- After mount, shows current theme icon and enables dropdown
- Clicking an option calls `setTheme()` from `next-themes`
- For authenticated users, also calls `updatePreferences()` server action and `useSession().update()`

**Placement**: Sidebar footer (next to lean mode toggle) and appearance settings page.

---

### LeanModeToggle

**Location**: `src/components/lean-mode-toggle.tsx`
**Type**: Client component (`"use client"`)
**Purpose**: Switch for toggling lean mode on/off.

**Props**: None

**Rendered output**:
- `Switch` component from shadcn/ui
- Label text: "Lean Mode"
- `aria-label="Toggle lean mode"`

**Behavior**:
- Reads current state from `useLeanMode()` hook
- Toggling calls `setLeanMode(!isLean)`
- For authenticated users, also persists via `updatePreferences()` server action

**Placement**: Sidebar footer (next to theme toggle) and appearance settings page.

---

### LeanModeProvider

**Location**: `src/contexts/lean-mode-context.tsx`
**Type**: Client component (`"use client"`)
**Purpose**: React context that manages the `data-retro` attribute on `<html>` and persists lean mode preference.

**Context value**:
```typescript
interface LeanModeContextValue {
  isLean: boolean;
  setLeanMode: (value: boolean) => void;
}
```

**Behavior**:
- On mount, reads `localStorage.getItem("lean-mode")` for initial state
- Default: `false` (retro effects ON — full aesthetic is the default experience)
- When `isLean` is `false`: sets `document.documentElement.setAttribute("data-retro", "")` (retro effects active)
- When `isLean` is `true`: calls `document.documentElement.removeAttribute("data-retro")` (retro effects off)
- Persists to `localStorage.setItem("lean-mode", String(value))`
- For initial render before mount: defaults to retro ON (data-retro present) via inline script in layout

---

## Hook Contracts

### useLeanMode

**Location**: `src/hooks/use-lean-mode.ts`
**Purpose**: Convenience hook wrapping `LeanModeContext`.

**Return type**:
```typescript
{ isLean: boolean; setLeanMode: (value: boolean) => void }
```

**Behavior**: Throws if used outside `LeanModeProvider`.

---

### useThemePreference

**Location**: `src/hooks/use-theme-preference.ts`
**Purpose**: Combines `next-themes` `useTheme()` with `useLeanMode()` and handles server persistence for authenticated users.

**Return type**:
```typescript
{
  theme: string;              // "light" | "dark" | "system"
  resolvedTheme: string;      // "light" | "dark" (resolved)
  setTheme: (value: string) => void;
  isLean: boolean;
  setLeanMode: (value: boolean) => void;
  isSaving: boolean;          // true while server action is in flight
}
```

**Behavior**:
- Wraps `useTheme()` and `useLeanMode()`
- On change (theme or lean mode), calls `updatePreferences()` server action if user is authenticated
- On success, calls `useSession().update({ preferences })` to refresh JWT
- On failure, rolls back to previous value
- Exposes `isSaving` for UI loading states

---

## Server Action Contracts

### updatePreferences

**Location**: `src/actions/preferences.ts`
**Signature**: `(input: unknown) => Promise<ActionResult<UserPreferences>>`

**Input validation** (Zod):
```typescript
z.object({
  theme: z.enum(["light", "dark", "system"]),
  leanMode: z.boolean(),
})
```

**Success response**: `{ success: true, data: { theme: "dark", leanMode: false } }`
**Error responses**:
- `{ success: false, error: "Unauthorized" }` — no session
- `{ success: false, error: "Validation failed", fieldErrors: {...} }` — invalid input
- `{ success: false, error: "Failed to save preferences" }` — DB error

**Side effects**: Updates `users.preferences` JSONB column and `users.updatedAt` timestamp.

---

## CSS Contract

### HTML Attribute State

The `<html>` element carries two independent state indicators:

| Attribute | Values | Managed by | Effect |
| --------- | ------ | ---------- | ------ |
| `class` | `""` or `"dark"` | `next-themes` | Switches all `--color-*` CSS custom properties between light and dark palettes |
| `data-retro` | present or absent | `LeanModeProvider` | Sets `--retro` to `1` (present) or `0` (absent), controlling all retro-glitch effects |

### CSS Custom Properties Contract

| Property | Scope | Values | Purpose |
| -------- | ----- | ------ | ------- |
| `--retro` | `:root` / `[data-retro]` | `0` or `1` | Master switch for all retro-glitch effects |
| `--color-phosphor-green` | `@theme` | `oklch(0.86 0.29 142)` | Primary neon accent |
| `--color-phosphor-cyan` | `@theme` | `oklch(0.91 0.19 196)` | Secondary neon accent |
| `--color-phosphor-magenta` | `@theme` | `oklch(0.70 0.32 328)` | Tertiary neon accent |
| `--color-phosphor-amber` | `@theme` | `oklch(0.82 0.19 72)` | Warm neon accent |
| `--font-mono-retro` | `@theme` | `"JetBrains Mono", ui-monospace, monospace` | Retro typography |

### Tailwind Utility Classes

| Utility | Effect | Lean Mode Behavior |
| ------- | ------ | ------------------ |
| `scanlines` | Adds repeating horizontal line overlay via `::after` | Opacity collapses to 0 |
| `noise-static` | Adds subtle noise texture via `::before` SVG | Opacity collapses to 0 |
| `border-glitch` | Double offset shadow border in neon colors | Shadow values collapse to 0 |
| `border-pixel` | Stepped gradient border via `border-image` | No change (static, not distracting) |
| `neon-glow-green` | Layered neon text-shadow in green | Active in all modes (subtle) |
| `neon-glow-cyan` | Layered neon text-shadow in cyan | Active in all modes (subtle) |
| `neon-glow-amber` | Layered neon text-shadow in amber | Active in all modes (subtle) |
| `neon-box-green` | Neon box-shadow with inner glow | Active in all modes (subtle) |
| `badge-retro` | Monospace uppercase badge styling | Font stays, color reverts to default |
| `animate-flicker` | Subtle brightness flicker animation | Disabled (prefers-reduced-motion) |
| `animate-glitch-border` | Chromatic aberration border shift | Disabled (prefers-reduced-motion) |

### Custom Tailwind Variant

| Variant | Selector | Usage |
| ------- | -------- | ----- |
| `retro:` | `&:where([data-retro], [data-retro] *)` | `retro:border-phosphor-green` — only applies when retro mode is active |
