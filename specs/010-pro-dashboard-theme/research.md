# Research: Professional Dashboard Theme

**Feature**: 010-pro-dashboard-theme
**Date**: 2026-03-06

## R1: #a4c400 Color Conversion to OKLCh

**Decision**: Use `oklch(0.78 0.19 120)` as the OKLCh approximation of #a4c400 for the primary accent color.

**Rationale**: The codebase uses OKLCh color model exclusively for all CSS custom properties. #a4c400 is a bright yellow-green (HSL ~73, 100%, 38%). In OKLCh this maps approximately to lightness 0.78, chroma 0.19, hue 120. This preserves the perceptual brightness and saturation of the brand color within the modern color space already used by the project.

**Alternatives considered**:
- Raw hex in CSS variables — rejected, inconsistent with existing oklch() convention
- HSL conversion — rejected, project uses oklch() exclusively

## R2: Retro-Glitch Removal Strategy

**Decision**: Remove all retro-glitch CSS utilities, phosphor color tokens, `data-retro` attribute system, lean-mode context/hook/toggle, and JetBrains Mono font. Remove `retro:` class prefixes from all component files.

**Rationale**: The spec requires complete replacement of the retro-glitch aesthetic. The retro system spans:
- **CSS definitions** (globals.css lines 6, 47-51, 90-92, 137-270): Custom variant, phosphor colors, `--retro` variable, 11 utility classes, 2 animation keyframes, reduced-motion block
- **State management**: `lean-mode-context.tsx`, `use-lean-mode.ts`, lean-mode toggle component, inline script in layout.tsx
- **Component usage**: 3 files use `retro:` classes — `app-sidebar.tsx` (3 references), `page.tsx` (3 references), `settings/appearance/page.tsx` (7 references)
- **Preferences**: `leanMode` property in UserPreferences type, database schema default, preferences action
- **Font**: JetBrains Mono loaded in layout.tsx, `--font-mono-retro` variable

Since the professional theme fully replaces the retro-glitch aesthetic (per spec assumption), all of these can be removed cleanly. The lean-mode toggle becomes unnecessary as there is no decorative mode to toggle off.

**Alternatives considered**:
- Keep retro utilities but disable by default — rejected per spec: "no retro mode toggle needs to be preserved"
- Keep JetBrains Mono for code blocks — rejected, Inter is the body font and system monospace suffices for any code display

## R3: Professional Color Palette Design

**Decision**: Design a neutral professional palette with #a4c400 green as the primary accent.

**Light mode palette**:
- Background: white/near-white (oklch ~1.0)
- Foreground: dark charcoal (oklch ~0.15-0.20)
- Primary: #a4c400 green (oklch 0.78 0.19 120) — used for buttons, links, active states
- Primary foreground: dark text on green (oklch ~0.18) — for readability on bright green background
- Secondary: light warm gray (oklch ~0.96)
- Muted: light gray for disabled/secondary text
- Accent: light green tint for hover/highlight areas
- Border: light gray (oklch ~0.91)

**Dark mode palette**:
- Background: dark charcoal (oklch ~0.16)
- Foreground: light gray (oklch ~0.97)
- Primary: #a4c400 green (may need slight brightness boost for dark backgrounds)
- Primary foreground: dark text (oklch ~0.18) on green buttons
- Secondary: dark gray (oklch ~0.25)
- Cards: slightly lighter than background (oklch ~0.21)

**Rationale**: Professional dashboards use neutral grays with a single brand accent color. The green is bright enough (L=0.78) to work as an accent in both modes. Dark text on #a4c400 background passes WCAG AA (contrast ratio ~7:1 with black text).

**Alternatives considered**:
- Using green as background color — rejected, too overwhelming; green works best as accent
- Softer/darker green variant — rejected, user specified #a4c400 exactly

## R4: Chart Palette with Brand Color

**Decision**: Design a 5-color chart palette anchored by #a4c400 as chart-1, with complementary professional colors for chart-2 through chart-5.

**Light mode chart palette**:
- chart-1: oklch(0.78 0.19 120) — Brand green #a4c400
- chart-2: oklch(0.55 0.15 250) — Professional blue (contrast with green)
- chart-3: oklch(0.65 0.18 45) — Warm amber/orange
- chart-4: oklch(0.50 0.15 300) — Muted purple
- chart-5: oklch(0.60 0.12 180) — Teal/cyan

**Dark mode chart palette**:
- chart-1: oklch(0.80 0.19 120) — Brand green (slightly brighter)
- chart-2: oklch(0.65 0.17 250) — Lighter blue
- chart-3: oklch(0.72 0.18 45) — Lighter amber
- chart-4: oklch(0.62 0.16 300) — Lighter purple
- chart-5: oklch(0.68 0.14 180) — Lighter teal

**Rationale**: The palette uses hue separation (~60-80 degree spacing) for distinguishability while maintaining a professional, muted tone. Brand green leads. Colors are adjusted for dark mode to maintain legibility against dark backgrounds.

## R5: Sidebar Token Strategy

**Decision**: Update sidebar tokens to match the professional palette — dark sidebar in light mode (common dashboard pattern) OR matching light sidebar. Use matching sidebar (same bg as main) for simplicity and consistency.

**Rationale**: The current sidebar tokens (sidebar, sidebar-foreground, sidebar-primary, etc.) map 1:1 with the main theme tokens. For a professional dashboard, the sidebar should use the same neutral palette with the green accent for the active navigation item. This maintains consistency without adding complexity.

**Alternatives considered**:
- Dark sidebar in light mode (corporate look) — viable but adds complexity; can be a follow-up enhancement
- Green-tinted sidebar — rejected, too much brand color

## R6: Settings/Appearance Page Update

**Decision**: Update the appearance settings page to remove the lean-mode toggle and retro preview elements. Keep the light/dark/system theme selector.

**Rationale**: With retro-glitch removed, the appearance page only needs the theme mode selector. The lean-mode toggle, retro preview cards, and retro effect demonstrations become irrelevant.

## R7: UserPreferences Schema Change

**Decision**: Remove the `leanMode` property from UserPreferences type and database defaults. Keep `theme` property.

**Rationale**: The leanMode preference controlled retro-glitch effects. With those removed, the preference serves no purpose. The database column stores JSON, so removing a property from the default value is backward-compatible (existing rows with `leanMode` will simply have an unused property).

## R8: Font Cleanup

**Decision**: Remove JetBrains Mono font import from layout.tsx and `--font-mono-retro` variable from globals.css. Keep Inter as the primary font.

**Rationale**: JetBrains Mono was only used by the `badge-retro` utility class and retro-themed typography. The professional theme uses Inter (or system fonts) exclusively. Removing the font import reduces page weight.

## R9: Hardcoded Color Fix

**Decision**: Replace the hardcoded `text-green-600` in `reports-charts-panel.tsx` with the brand green token.

**Rationale**: The codebase audit found one hardcoded color: `text-green-600` used for positive spend trend indicators. This should use the brand primary color for consistency. The `--primary` token will be green, so `text-primary` is appropriate.
