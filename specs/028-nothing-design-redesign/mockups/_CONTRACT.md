# Mockup Authoring Contract — Nothing redesign

Every screen mockup is a standalone `.html` file in this `mockups/` folder. It MUST link the shared
`./styles/nothing.css` and `./styles/theme.js` and reuse the shell + component classes below verbatim.
This file is the single source of consistency. Do not invent new color/spacing values, new fonts, or
ad-hoc component styles. If a screen needs something truly bespoke, add a small scoped `<style>` block
that only uses the existing CSS custom properties (`var(--...)`).

## Hard rules (Nothing)

- **Three layers only** per screen: ONE primary (hero number / title), secondary context, tertiary
  metadata. Make the primary large and the tertiary small — the contrast IS the hierarchy.
- **Monochrome canvas.** Greyscale does the hierarchy. `--accent` red is an *interrupt* — at most one
  red UI moment per screen (active state / destructive / the single urgent number). If nothing is
  urgent, no red.
- **Data-status colors** (`--success` / `--warning` / `--accent`) are applied to the **value text only**,
  never to row backgrounds or labels. Labels stay `--text-secondary`.
- **Fonts:** Space Grotesk (UI/body), Space Mono (ALL CAPS labels + all numbers/data), Doto (hero
  display 36px+ only). Max 2 families visible per screen besides a single Doto hero moment.
- **Both modes must look intentional.** Use only the tokens; never hardcode `#fff`/`#000`. Test by
  flipping the toggle — light is a printed-manual look, dark is an instrument panel.
- **Anti-patterns — never:** shadows, gradients in chrome, blur, skeletons, toast popups, zebra
  striping, filled/multi-color icons, emoji, border-radius > 16px on cards, bounce/spring easing.
  Use inline `[SAVED]` / `[ERROR]` status text, `[LOADING…]`, and dividers/spacing instead of cards
  for everything.
- Mockups show realistic **sample data** drawn from the real page (real labels, plausible numbers,
  real tool/user/vendor names). They are static — links can be `#` or sibling mockups; no real JS
  behaviour beyond the theme toggle.

## Canonical filenames (use these exact names for cross-links)

`dashboard.html` `tools.html` `users.html` `assignments.html` `requests.html` `budget.html`
`reports.html` `copilot.html` `claude.html` `invoices.html` `settings.html` `login.html`

## Shell — copy verbatim, then (1) set `<title>`, (2) add `active` to the current nav item, (3) fill topbar + `<main>` content

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AI Developer Hub — SCREEN · Nothing</title>
  <link rel="stylesheet" href="./styles/nothing.css" />
  <script src="./styles/theme.js"></script>
</head>
<body>
  <div class="app">
    <aside class="sidebar">
      <div class="brand"><span class="dot"></span><span class="wordmark">AI&middot;HUB</span></div>
      <nav class="nav">
        <a class="nav-item" href="./dashboard.html">Dashboard</a>
        <a class="nav-item" href="./tools.html">Tools</a>
        <a class="nav-item" href="./users.html">Users</a>
        <a class="nav-item" href="./assignments.html">Assignments</a>
        <a class="nav-item" href="./requests.html">Requests</a>
        <a class="nav-item" href="./budget.html">Budget</a>
        <a class="nav-item" href="./reports.html">Reports</a>
        <a class="nav-item" href="./copilot.html">Copilot</a>
        <a class="nav-item" href="./claude.html">Claude Console</a>
        <a class="nav-item" href="./invoices.html">Invoices</a>
        <a class="nav-item" href="./settings.html">Settings</a>
      </nav>
      <div class="sidebar-footer">
        <div class="user-chip">
          <span class="avatar">TS</span>
          <span class="stack">
            <span class="t-primary" style="font-size:13px">Tobias Studer</span>
            <span class="label">Admin</span>
          </span>
        </div>
        <a class="nav-item" href="./login.html">Sign Out</a>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div>
          <div class="label eyebrow">SECTION&nbsp;/&nbsp;CONTEXT</div>
          <h1 class="display-md">Page Title</h1>
        </div>
        <div class="topbar-actions">
          <!-- screen-specific actions (search, primary button, period nav) go here, BEFORE the toggle -->
          <div class="theme-toggle">
            <button data-theme="dark" class="active">Dark</button>
            <button data-theme="light">Light</button>
          </div>
        </div>
      </header>

      <!-- ===== SCREEN CONTENT ===== -->

    </main>
  </div>
</body>
</html>
```

For **auth** (`login.html`) skip the `.app`/sidebar shell entirely — use `.auth-screen` > `.auth-card`
and put a small `.theme-toggle` top-right or below the card.

## Component cheat-sheet (classes already in nothing.css)

**Hero metric**
```html
<div class="metric metric-hero">
  <span class="label">TOTAL ANNUAL BUDGET</span>
  <span class="metric-value is-doto">128,400<span class="metric-unit">CHF</span></span>
  <span class="metric-trend t-success">&uarr; 4.2% vs last year</span>
</div>
```

**KPI card grid**
```html
<div class="grid grid--kpi">
  <div class="card"><span class="label card-label">SPENT YTD</span>
    <div class="metric"><span class="metric-value">82,140<span class="metric-unit">CHF</span></span></div>
  </div>
  <!-- … -->
</div>
```

**Segmented progress bar** (signature viz — generate ~20 `.seg`; fill the proportion; overflow segments use `is-over`)
```html
<div class="seg-head"><span class="label">CLAUDE API · MARCH</span><span class="value value--warning mono">78%</span></div>
<div class="seg-bar seg-bar--hero">
  <span class="seg is-filled"></span> <!-- repeat filled… --> <span class="seg"></span> <!-- …then empty -->
</div>
```

**Stat rows**
```html
<div class="stat-list">
  <div class="stat-row"><span class="label">GITHUB COPILOT</span><span class="value value--success">$1,240.00</span></div>
  <div class="stat-row"><span class="label">ANTHROPIC API</span><span class="value value--accent">$3,910.50</span></div>
</div>
```

**Table** (numbers right + `.num` mono, active row gets `is-active`)
```html
<table class="table">
  <thead><tr><th>Tool</th><th>Vendor</th><th class="num">Seats</th><th class="num">Monthly</th><th>Status</th></tr></thead>
  <tbody>
    <tr><td class="cell-strong">GitHub Copilot</td><td>GitHub</td><td class="num">42</td><td class="num">$798.00</td>
        <td><span class="tag tag--success"><span class="led"></span>Active</span></td></tr>
  </tbody>
</table>
```

**Buttons** `.btn .btn--primary | --secondary | --ghost | --destructive` (add `.btn--sm`). **Tags**
`.tag` + `--success/--warning/--accent/--active`, optional `<span class="led"></span>`. **Segmented
control** `.segmented > button(.active)`. **Tabs** `.tabs > .tab(.active)`. **Period nav** `.period-nav`
with `.nav-arrow`, `.period-label`. **Switch** `.switch(.on)`. **Field** `.field > label.label + .control`.
**Search** `.search > svg + input`. **Empty** `.empty > .empty-title + .empty-sub`.

## Inline monoline icons (16–20px, stroke 1.5, currentColor) — reuse, don't invent

```html
<!-- search -->   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
<!-- plus -->     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
<!-- chevron-left --> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
<!-- chevron-right--> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
<!-- chevron-down --> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
<!-- close (x) --> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
<!-- arrow-up (trend) --> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
<!-- arrow-down (trend) --> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>
<!-- check --> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
<!-- upload --> <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
```

## Sparkline / line chart (mockup-scale)

Use inline `<svg>` with `stroke="var(--text-display)"` `stroke-width="1.5"` `fill="none"`. Average line:
`stroke="var(--text-secondary)" stroke-dasharray="3 3"`. Axis labels: `.axis > span`. No area fill, no
legend boxes — label the line directly. For vertical bars use `.bars > .bar` (add `.is-muted`/`.is-accent`).
