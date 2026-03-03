# Research: Retro-Glitch Theme System

**Feature Branch**: `002-retro-glitch-themes`
**Date**: 2026-03-03

## R1: next-themes Integration with Next.js 15 + Tailwind CSS v4

### Decision
Use `next-themes` v0.4.6 (already installed) with `attribute="class"`, `defaultTheme="system"`, and `enableSystem`. Create a thin `"use client"` wrapper component (`ThemeProvider`) since App Router layouts are server components.

### Rationale
- `next-themes` is the industry standard for Next.js theming (2KB gzipped, zero runtime cost)
- Already installed as a dependency but not configured — just needs wiring
- The Sonner toaster component already imports `useTheme()` from `next-themes`, so adding the provider will make it work correctly
- Inline blocking script prevents FOUC without cookies or dynamic rendering penalties

### Key Implementation Details

**ThemeProvider wrapper**: Create `src/components/theme-provider.tsx` as a `"use client"` component wrapping `NextThemesProvider`. Import in `layout.tsx` (server component) — only the provider subtree becomes client-side.

**Layout changes**:
- Add `suppressHydrationWarning` to `<html>` tag (required — `next-themes` mutates the class before React hydrates)
- Wrap all children in `<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>`
- Move `<Toaster />` inside `ThemeProvider` so `useTheme()` has context

**Tailwind v4 dark variant fix**: Change line 5 of `globals.css` from:
```css
@custom-variant dark (&:is(.dark *));
```
to:
```css
@custom-variant dark (&:where(.dark, .dark *));
```
This ensures `dark:` utilities work on the `.dark` element itself, not just descendants. Uses `:where()` for zero specificity.

**Theme toggle component**: Use shadcn/ui `DropdownMenu` with three options (Light / Dark / System). The Sun/Moon icon swap uses Tailwind `dark:` classes that work immediately thanks to the anti-FOUC script. Include a `mounted` guard to prevent hydration mismatch.

### Alternatives Considered
- **Cookie-based theming**: Would eliminate even the theoretical 1-frame FOUC but makes all routes dynamic in Next.js 15. Since `layout.tsx` already calls `await auth()` (already dynamic for authenticated routes), this is viable for authenticated users. However, `next-themes` v0.4.x does not have native cookie support (PR #294 was closed Feb 2025). Not worth the custom implementation complexity.
- **CSS-only `prefers-color-scheme`**: No user override capability. Rejected.
- **Custom theme context**: Would duplicate what `next-themes` already provides, with worse FOUC handling. Rejected.

---

## R2: Retro-Glitch CSS Architecture

### Decision
Implement all retro-glitch effects as pure CSS using Tailwind v4 `@utility` directives and CSS custom properties. Use a `--retro` numeric switch (0 or 1) on `:root` to control all effects via `calc()` multiplication. Use `data-retro` attribute on `<html>` for toggling.

### Rationale
- Zero JS runtime cost — all effects are CSS-only
- Single `--retro: 0/1` switch cleanly disables all effects by collapsing `calc(var(--retro) * value)` to zero
- Works with Tailwind v4's `@custom-variant` for a `retro:` prefix in utility classes
- `prefers-reduced-motion` handled at CSS level by setting `--retro: 0` in the reduce-motion media query
- No new dependencies required

### Key Effects and Techniques

**Phosphor accent colors** (oklch for wide-gamut support):
- Green (P31 CRT): `oklch(0.86 0.29 142)`
- Cyan (P7 blue): `oklch(0.91 0.19 196)`
- Magenta (EGA): `oklch(0.70 0.32 328)`
- Amber (P3 CRT): `oklch(0.82 0.19 72)`

Registered via `@theme` block so Tailwind generates `text-phosphor-green`, `bg-phosphor-cyan`, etc. automatically.

**Scanline overlay**: `repeating-linear-gradient` on `::after` pseudo-element with `pointer-events: none`. Opacity multiplied by `--retro`: `oklch(0 0 0 / calc(var(--retro) * 0.12))`. Collapses to transparent when `--retro: 0`.

**Noise/static texture**: SVG `feTurbulence` filter encoded as data URI in `::before` pseudo-element. `baseFrequency: 0.9`, `numOctaves: 4`. Opacity: `calc(var(--retro) * 0.06)`. CPU-rendered at paint time, not per-frame — safe for production.

**Glitch borders**: Double offset `box-shadow` in cyan/magenta with chromatic aberration effect. Pixel-stepped `border-image` variant using `repeating-linear-gradient`. Note: `border-image` does not respect `border-radius` — use `box-shadow` for rounded elements.

**Neon glow**: Layered `text-shadow` (4px, 12px, 24px) using phosphor colors with `color-mix()` for the outermost falloff. Box variant uses `box-shadow` with inset for inner glow.

**Typography accents**: JetBrains Mono for retro monospace headings/badges. `letter-spacing: 0.15em`, `text-transform: uppercase` for badge style. Only for decorative labels — body text stays Inter.

**Animation safety**: All `@keyframes` wrapped in `@media (prefers-reduced-motion: no-preference)`. Global kill-switch at bottom of stylesheet: `animation-duration: 1ms !important` for `prefers-reduced-motion: reduce`.

### Alternatives Considered
- **Canvas-based noise**: Higher visual quality but significant JS runtime cost and complexity. Rejected per Constitution Principle V (Simplicity).
- **GIF/PNG textures**: Larger file sizes, less control. SVG data URI is smaller and more flexible. Rejected.
- **JavaScript-driven glitch effects**: Would break server rendering, add bundle size, and require complex state management. CSS-only is simpler and more performant. Rejected.
- **CSS Houdini `paint()` worklet**: Not supported in Firefox/Safari. Rejected for cross-browser compatibility.

---

## R3: Lean Mode Architecture

### Decision
Implement lean mode as a React context (`LeanModeProvider`) that manages a `data-retro` attribute on `<html>`. When lean mode is OFF, `data-retro` is present and `--retro: 1`. When lean mode is ON, `data-retro` is absent and `--retro: 0`. All retro effects automatically collapse via CSS `calc()`.

### Rationale
- Single boolean state (lean on/off) — no complex state machine
- CSS does all the work — toggling one attribute switches the entire aesthetic
- Independent of theme (dark/light) — the two axes compose cleanly
- No layout recalculation needed — only visual decoration changes

### Key Implementation Details
- `LeanModeProvider` is a `"use client"` context wrapping children in layout
- Reads initial value from `localStorage` (key: `lean-mode`) synchronously via inline script (same pattern as `next-themes`)
- Provides `useLeanMode()` hook returning `{ isLean, setLeanMode }`
- When toggled, adds/removes `data-retro` attribute on `document.documentElement`

### Alternatives Considered
- **CSS class toggle instead of data attribute**: Works but `data-*` attributes are semantically clearer and don't collide with Tailwind class names. Chosen `data-retro` for clarity.
- **Tailwind v4 `@custom-variant`**: Defined `retro:` variant via `@custom-variant retro (&:where([data-retro], [data-retro] *))` — allows `retro:border-phosphor-green` in JSX. Complements the `calc()` approach for elements that need binary class swapping rather than opacity scaling.
- **Server-side lean mode via cookie**: Same trade-off as theme cookie. Lean mode is decorative-only, so a brief flash of retro effects before JS hydrates is acceptable. Cookie approach rejected for simplicity.

---

## R4: Preference Persistence Strategy

### Decision
Dual persistence: `localStorage` for unauthenticated users (theme via `next-themes`, lean mode via custom key), `jsonb` column on the `users` table for authenticated users. Server preferences take priority on login.

### Rationale
- `localStorage` provides instant access without network latency for unauthenticated users
- `next-themes` already manages theme persistence in `localStorage` — no custom code needed for that axis
- JSONB column on `users` table avoids a separate join; preference set is small and stable (2 fields)
- JWT callback embeds preferences into token at sign-in, avoiding per-request DB lookups
- `useSession().update()` refreshes the JWT when preferences change, keeping client and server in sync

### Key Implementation Details

**Schema change**: Add `preferences jsonb DEFAULT '{"theme":"system","leanMode":false}'` to `users` table. Type-safe via Drizzle `.$type<UserPreferences>()`.

**Auth integration**: Extend `jwt` callback to fetch and embed `preferences` at sign-in. Extend `session` callback to expose `preferences` on `session.user`. Handle `trigger === "update"` for preference changes.

**Server Action**: `updatePreferences()` in `src/actions/preferences.ts` validates with Zod, writes full preferences object to DB, returns `ActionResult<UserPreferences>`. Client calls `useSession().update({ preferences })` on success to refresh JWT.

**Sync on login**: Client hook reads `session.user.preferences` after authentication, calls `setTheme()` and updates lean mode context. Server wins (cross-device authority). Client localStorage is overwritten with server values.

### Alternatives Considered
- **Separate preferences table**: Overkill for 2 fields. Would require a join on every session. Rejected per Constitution Principle V.
- **Cookie-only persistence**: Cookies are limited to 4KB, not suitable for future preference expansion. Also requires `httpOnly: false` which is a minor security concern. Rejected.
- **IndexedDB**: More complex API for no benefit over `localStorage` for 2 string values. Rejected.

---

## R5: Font Loading Strategy for JetBrains Mono

### Decision
Load JetBrains Mono via `next/font/google` (Next.js built-in font optimization) rather than a `@import url()` in CSS.

### Rationale
- Next.js font optimization self-hosts the font, eliminating the external Google Fonts request
- Automatic `font-display: swap` prevents invisible text during load
- CSS variable output integrates directly with Tailwind v4 `@theme` `--font-mono-retro`
- No FOUT/FOIT concerns — font loads with the same priority as the page

### Implementation
```tsx
// In layout.tsx or a shared config
import { JetBrains_Mono } from "next/font/google";
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-retro" });
// Add variable to <html> className
```

### Alternatives Considered
- **CSS `@import url()`**: External request to Google Fonts, render-blocking. Rejected.
- **Self-hosted font files in `/public`**: Manual management. `next/font` handles this automatically. Rejected.
