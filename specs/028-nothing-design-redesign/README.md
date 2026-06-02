# 028 — Nothing Design Redesign

## Overview

This spec proposes replacing the AI Developer Hub's current, inconsistent theming with one
coherent visual system inspired by Nothing's instrument-panel / printed-manual aesthetic. The
existing UI leans on a green-primary shadcn theme (`--primary: oklch(0.78 0.19 120)`) applied
unevenly across screens, with mixed type, ad-hoc accent usage, and shadow-heavy surfaces.

**Goal:** a single source of truth — `mockups/styles/nothing.css` — that styles every screen with
the same monochrome canvas, one disciplined red interrupt, a type-driven hierarchy, and flat
bordered surfaces. Both dark and light are first-class, not an afterthought. Dark reads as an
instrument panel; light reads as a printed manual.

The `mockups/` folder contains a standalone, framework-free HTML mockup per screen plus a gallery
index, all sharing `nothing.css`. These are static design references — the eventual implementation
maps these tokens onto the app's real `src/app/globals.css`.

## Font declaration

Three families, each with one job. Maximum two families visible per screen plus a single Doto hero
moment.

| Role | Family | Usage |
| --- | --- | --- |
| **Display / hero** | **Doto** | Hero display numbers and titles only, 36px+. |
| **UI / body** | **Space Grotesk** | All interface chrome, headings, and prose. |
| **Labels + all data** | **Space Mono** | ALL-CAPS tracked labels, plus every number / metric / table value. |

Exact `@import` line used at the top of `mockups/styles/nothing.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Doto:wght@400;500;700&family=Space+Grotesk:wght@300;400;500;700&family=Space+Mono:wght@400;700&display=swap');
```

These are exposed as tokens:

```css
--font-display: "Doto", "Space Mono", monospace;
--font-ui:      "Space Grotesk", "DM Sans", system-ui, sans-serif;
--font-mono:    "Space Mono", "JetBrains Mono", "SF Mono", monospace;
```

## How to view

Open **`mockups/index.html`** in a browser. It is a self-contained gallery — no build step, no
server. Each card links to a sibling screen mockup. Use the Dark / Light toggle (top-right of every
page) to verify both modes; the choice persists across pages via `localStorage`.

## Screens

| # | Screen | Route | Mockup |
| --- | --- | --- | --- |
| 01 | Dashboard | `/` | `mockups/dashboard.html` |
| 02 | AI Tools | `/tools` | `mockups/tools.html` |
| 03 | Users | `/users` | `mockups/users.html` |
| 04 | License Assignments | `/assignments` | `mockups/assignments.html` |
| 05 | Access Requests | `/requests` | `mockups/requests.html` |
| 06 | Budget | `/budget` | `mockups/budget.html` |
| 07 | Reports | `/reports` | `mockups/reports.html` |
| 08 | GitHub Copilot | `/copilot` | `mockups/copilot.html` |
| 09 | Claude Console | `/claude` | `mockups/claude.html` |
| 10 | Invoices | `/invoices` | `mockups/invoices.html` |
| 11 | Settings | `/settings` | `mockups/settings.html` |
| 12 | Sign In | `/login` | `mockups/login.html` |

## Nothing principles applied

- **Monochrome canvas + one red interrupt.** Greyscale carries the entire hierarchy. The `--accent`
  red (`#d71921`) appears at most once per screen — an active state, a destructive action, or the
  single urgent number. If nothing is urgent, there is no red.
- **Type-driven 3-layer hierarchy.** Exactly three layers per screen: one large primary (hero number
  or title), secondary context, and small tertiary metadata. The size contrast *is* the hierarchy —
  no boxes or color needed to separate them.
- **Flat bordered surfaces / no shadows.** Cards and panels are defined by 1px borders and spacing,
  never drop shadows, gradients, or blur. Status colors apply to value text only, never to row
  backgrounds or labels.
- **Segmented-bar data viz.** The signature visualization is a segmented progress bar (~20 discrete
  segments) rather than smooth fills; overflow segments turn red. Charts are thin inline SVG lines,
  labeled directly with no legend boxes or area fills.
- **Both modes first-class.** Every value is a token — no hardcoded `#fff` / `#000`. Flipping the
  toggle yields two intentional looks: dark = instrument panel, light = printed manual.

## Migration notes

`mockups/styles/nothing.css` is authored as the proposed replacement for the app's
`src/app/globals.css` design tokens. The Nothing tokens map directly onto the existing shadcn token
names, so adoption is largely a values swap (plus wiring the three font families and switching the
dark-mode selector). The headline change is retiring the **oklch green primary**
(`oklch(0.78 0.19 120)`) in favor of a monochrome canvas with a single red interrupt.

Key token swaps (current `globals.css` → proposed Nothing equivalent):

| shadcn token | Current value | Nothing equivalent (dark / light) |
| --- | --- | --- |
| `--background` | `oklch(0.16 0 0)` dark · `oklch(1 0 0)` light | `--black` `#000000` / `#f5f5f5` |
| `--foreground` | `oklch(0.97 0 0)` dark · `oklch(0.145 0 0)` light | `--text-primary` `#e8e8e8` / `#1a1a1a` (display text → `--text-display` `#ffffff` / `#000000`) |
| `--card` / `--popover` | `oklch(0.21 0 0)` dark · `oklch(1 0 0)` light | `--surface` `#111111` / `#ffffff` (raised → `--surface-raised` `#1a1a1a` / `#f0f0f0`) |
| `--primary` | `oklch(0.78 0.19 120)` **green** (both modes) | `--text-display` (monochrome) — primary actions become high-contrast greyscale, **not** a brand hue |
| `--accent` | `oklch(0.25 0.03 120)` / `oklch(0.95 0.03 120)` green-tinted | `--accent` `#d71921` red interrupt (subtle fill → `--accent-subtle`) |
| `--destructive` | `oklch(0.704 0.191 22.216)` / `oklch(0.577 0.245 27.325)` | `--error` `#d71921` (unified with the single accent red) |
| `--border` / `--input` | `oklch(1 0 0 / 10%)` dark · `oklch(0.91 0 0)` light | `--border` `#222222` / `#e8e8e8` (visible → `--border-visible` `#333333` / `#cccccc`) |
| `--ring` | `oklch(0.78 0.19 120)` green | `--border-visible` / `--text-primary` focus, no green ring |
| Fonts | shadcn default (system / Geist) | `--font-ui` Space Grotesk, `--font-mono` Space Mono, `--font-display` Doto (see `@import` above) |

Status colors (`--success #4a9e5c`, `--warning #d4a843`) are new value-text-only tokens with no
direct shadcn equivalent; the existing rainbow `--chart-1..5` would collapse to greyscale +
segmented bars. The app's `.dark` class selector maps to the mockup's `:root` (dark) default and
`:root[data-theme="light"]` override pattern.
