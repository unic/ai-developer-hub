---
name: agent-browser-session
description: Mint a NextAuth-compatible session cookie for the seeded Nighthawk agent user so the browser (Playwright, Chrome DevTools MCP, or curl) can hit auth-gated routes without going through the human `/login` flow. Use whenever you're testing this app in a browser against `localhost:3000` or a Vercel preview and an auth-gated page (anything not in `isPublicPath`) redirects to `/login`, or whenever the user asks to "log in as the agent", "sign in for testing", "skip the login screen", or "test the dashboard / admin / reports / settings UI". The route refuses production by design and is rate-limited only by its 30-minute TTL. Do not invoke against production; do not attempt to use the minted session against any endpoint on the built-in agent deny-list (DELETE /api/users, POST /api/users/invite, /api/users/reset-password, /api/invoices/ingest, /api/sync, /setup-password, POST /api/anthropic-config, POST /api/github-config) — those are blocked in middleware and you will get 403.
---

# Mint a browser session for the Nighthawk agent user

This app gates most routes behind NextAuth. When you (the AI agent) are testing the UI in a browser, you cannot use a human's password and you don't want to forge cookies yourself. The repo ships an explicit route that does this safely: `POST /api/agent/session` mints a NextAuth-shaped session JWT for a pre-seeded agent user and returns it as a `Set-Cookie` header.

This skill covers: when to use it, what must be set up first, the exact mint call, how to inject the cookie into each browser-automation tool, and what you may **not** do with the resulting session.

## When this skill applies

Trigger when **all** of the following are true:

1. You are about to test the app in a browser (Playwright, Chrome DevTools MCP, `curl` with cookie jar, or any other browser-automation flow).
2. The target environment is **local dev** (`http://localhost:3000`) or a **Vercel preview** deployment. Never production.
3. The page or API you need is auth-gated — i.e. it redirects to `/login` for anonymous requests, or returns 401/403. (Public pages — `/login`, `/setup-password`, etc. — don't need this; just navigate.)

If the user is testing a strictly public flow, **skip this skill** — there's no value in adding session state. The skill exists to unblock auth-gated testing, not to be applied to every browser run.

## When NOT to apply

- **Production** (`VERCEL_ENV=production`). The mint route hard-refuses with HTTP 403 — `Agent sessions are not available on production`. If the user explicitly asks for a session against production, refuse and explain.
- **Sync / ingest endpoints.** `/api/sync` and `/api/invoices/ingest` have their own bearer-token auth (`CRON_SECRET` / `INVOICE_INGEST_SECRET`) and are excluded from the session-cookie middleware matcher. The agent session does nothing for them — use the right secret instead.
- **Anything on the built-in deny-list** (see "Deny-list — what the session refuses" below). Even with a valid cookie, middleware returns 403. Don't try; surface to the user that this path is intentionally blocked for the agent.
- **As a substitute for real auth coverage in unit/E2E tests of the login flow itself.** If the user is debugging `signIn` / Credentials provider behavior, mint sessions hide bugs in that flow. Use a real test user instead.

## Preconditions — verify before minting

The mint route depends on environment state the user must have set up. Before calling, confirm all four exist:

1. **`AGENT_SESSION_SECRET` is set** in the active `.env.local` (worktree or main repo, whichever the dev server is reading). Generate with `openssl rand -base64 32` if missing.
2. **`AUTH_SECRET` is set** in the same `.env.local`. The mint code calls `next-auth/jwt` `encode()` with this secret — it must match what the dev server itself uses, otherwise the cookie decrypts to nothing and you still get redirected to `/login`.
3. **The agent user is seeded.** Run `pnpm db:seed:agent` against whatever DB the dev server is pointed at. The seed inserts a row with email `AGENT_USER_EMAIL` (default `nighthawk@agent.local`), `role=admin`, `status=active`, `isAgent=true`. The mint route returns HTTP 503 (`Agent user not provisioned`) if no such row exists. If you're in a worktree, **seed against the worktree's Neon branch**, not production — see the `neon-worktree-branch` skill.
4. **The dev server is running** on the URL you intend to hit (`pnpm dev` or `pnpm build && pnpm start`). The mint route lives in the Next.js app; without a server there's nothing to call.

Quick environment probe (read-only, safe):

```
# Check that .env.local has the required keys (don't print values)
grep -E '^(AGENT_SESSION_SECRET|AUTH_SECRET|AGENT_USER_EMAIL)=' .env.local | sed 's/=.*/=***/'

# Confirm the server is up
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/
```

If any precondition is missing, **stop and report to the user** which one. Don't auto-generate `AGENT_SESSION_SECRET` and write to `.env.local` without confirmation — that file may already exist with values the user is intentionally keeping, and rewriting can corrupt the dev server's view of the world mid-session.

## Mint the session

The mint route is `POST /api/agent/session` (src/app/api/agent/session/route.ts). It is excluded from the auth middleware matcher (src/middleware.ts) so anonymous requests reach it; the bearer header is the only gate. The Authorization header check uses `requireBearerSecret` (src/lib/auth-helpers.ts) — the header value **must** be exactly `Bearer <secret>`, no quotes, no trailing whitespace, no `Bearer:` colon variant. Anything else is 401.

Read `AGENT_SESSION_SECRET` from the active `.env.local` at call time — do not hardcode it in agent text, do not echo it back to the user, do not paste it into a markdown code block in the PR or in any comment. Treat it like a password.

### Mint via curl (most portable)

```
curl -sS -c cookies.txt -X POST \
  -H "Authorization: Bearer $AGENT_SESSION_SECRET" \
  http://localhost:3000/api/agent/session
```

`-c cookies.txt` writes the cookie jar to disk. Use `-b cookies.txt` on every subsequent authenticated request. Expected response body: `{"success":true,"cookieName":"authjs.session-token","expiresIn":1800}`. The cookie is set via `Set-Cookie` header — `-c` captures it transparently.

Expected status codes:

- `200` — success, session cookie issued
- `401` — wrong/missing bearer (check `AGENT_SESSION_SECRET` matches `.env.local`)
- `403` — production refused (you should not be here; abort)
- `500` — `AGENT_SESSION_SECRET` not set on the server (the dev server hasn't loaded `.env.local`, or the key is missing — restart dev server after editing `.env.local`)
- `503` — agent user not provisioned (run `pnpm db:seed:agent`)

Then drive the app:

```
curl -sS -b cookies.txt http://localhost:3000/dashboard
curl -sS -b cookies.txt http://localhost:3000/api/users
```

### Mint via Playwright

Use `playwright-skill` for the browser part; this skill only covers the session step. The cleanest way is to use the browser context's `request` API so the resulting cookie lands in the same context the page navigates with:

```ts
await context.request.post("http://localhost:3000/api/agent/session", {
  headers: { Authorization: `Bearer ${process.env.AGENT_SESSION_SECRET}` },
});
// Cookie is now in `context` — every page.goto() under this context is authenticated.
await page.goto("http://localhost:3000/dashboard");
```

Do **not** use `document.cookie` to read or set the session cookie: it's httpOnly. The `context.request` flow respects `Set-Cookie` from the server and persists it correctly. If you absolutely must inject the cookie directly (e.g. you already have the value from a prior curl), use `context.addCookies()` with `httpOnly: true, sameSite: 'Lax', path: '/'`.

### Mint via Chrome DevTools MCP

Two viable approaches:

1. **`evaluate_script` to `fetch` from the page context.** The page must already be loaded on the same origin (so the `Set-Cookie` is accepted). Navigate to `/login` first if needed:

   ```js
   await fetch('/api/agent/session', {
     method: 'POST',
     headers: { Authorization: 'Bearer ' + AGENT_SESSION_SECRET_FROM_HARNESS },
     credentials: 'same-origin',
   });
   ```

   The browser stores the cookie automatically. Then `navigate_page` to the protected route.

   You **must** pass the secret into the script from outside — never inline the literal value into `evaluate_script` source the user might see. Read it from a local file in agent memory and template it in just before the call; don't write it into anything that ends up in conversation transcripts unsanitized.

2. **Shell out to curl, then have the browser request the protected page.** Cookies live in the curl jar, not the browser. This only works if you're driving entirely via curl, **not** via Chrome DevTools MCP. If the browser session is the test surface, use option 1.

### Cookie name — HTTP vs HTTPS

The mint route returns `cookieName` in the response body. It will be:

- `authjs.session-token` on `http://` (local dev)
- `__Secure-authjs.session-token` on `https://` (preview deployments)

If you're hand-injecting cookies (rarely needed), use the exact name from the response — the JWE salt depends on it (see `getSessionCookieName` in src/lib/agent-auth.ts). Mixing them produces an invalid token that Auth.js silently rejects, and you get redirected back to `/login` with no obvious error.

## Session lifetime

- **TTL: 30 minutes** (`AGENT_SESSION_TTL_SECONDS = 30 * 60`, src/app/api/agent/session/route.ts).
- There is no refresh endpoint. When the cookie expires, mint a new one — same call, new cookie.
- The cookie is `httpOnly`, `sameSite: lax`, `path: /`. `secure: true` only on `__Secure-` (HTTPS) deployments.
- A new mint **does not invalidate prior cookies** (they're stateless JWTs). Old cookies just age out at their own 30-minute mark. Treat each mint as independent.

## Deny-list — what the session refuses

Even with a valid agent cookie, the middleware (src/middleware.ts → `isAgentDenied` in src/lib/agent-auth.ts) returns `403 Forbidden (agent deny-list)` for these paths:

- `DELETE /api/users`
- `POST /api/users/invite`
- `POST /api/users/reset-password`
- `/api/invoices/ingest` (any method)
- `/api/sync` (any method)
- `/setup-password` (any method)
- `POST /api/anthropic-config`
- `POST /api/github-config`
- Plus anything in the `AGENT_DENY_PATHS` env var (comma-separated, format `"/path"` or `"METHOD /path"`)

These are outbound side-effects (real email, R2 uploads, key rotations) and destructive admin operations. **Read-only admin pages are allowed.** If the user asks you to test one of these flows in the browser, surface that it's blocked for the agent user by design — the right answer is a unit/integration test, not the live UI.

Match is by prefix. `/api/users` (DELETE) is blocked; `GET /api/users` is allowed. `/api/invoices/ingest/anything` is blocked because the deny entry has no method qualifier. Check src/lib/agent-auth.ts:18 for the canonical list — keep this skill in sync if it changes.

## Cleanup

The cookie is httpOnly with a 30-minute max-age; the browser drops it on its own. No server-side state to clean up — agent sessions are stateless JWTs, not DB rows. Just stop using the cookie jar / browser context when done.

If you're tearing down a worktree's dev server, you can also delete `cookies.txt` (if you wrote one) to keep stray credentials out of the workspace. Don't commit it (it's already covered by typical gitignore patterns, but double-check before pushing anything).

## Failure-mode cheatsheet

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Mint returns 401 | Bearer mismatch | Re-read `AGENT_SESSION_SECRET` from `.env.local`, confirm dev server has the same value (restart server after editing `.env.local`) |
| Mint returns 403 | Production env | You're hitting prod by mistake. Abort. Never bypass. |
| Mint returns 500 | `AGENT_SESSION_SECRET` not loaded on server | Check `.env.local` exists in the dir the dev server was started from; restart `pnpm dev` |
| Mint returns 503 | Agent user not seeded | Run `pnpm db:seed:agent` against the active DB (in a worktree, the worktree's Neon branch) |
| Mint succeeds but protected page still redirects to `/login` | `AUTH_SECRET` differs between mint and server, or cookie name doesn't match (HTTPS vs HTTP), or browser context isn't using the cookie jar | Verify `AUTH_SECRET` is set in `.env.local` and unchanged since server start; use the `cookieName` from the mint response verbatim; for Playwright, mint via `context.request` not page-side `fetch` to a different origin |
| Protected page returns `Forbidden (agent deny-list)` | Path is on the BUILT_IN_DENY_PATHS or in `AGENT_DENY_PATHS` | Don't bypass. The block is intentional; surface to the user. |
| Mint works locally but fails on preview | Vercel preview missing `AGENT_SESSION_SECRET` env var, or seed never ran against the preview's DB branch | Add the env var in the Vercel project settings for the Preview environment; seed the preview's database |

## Secret hygiene (mandatory)

- Never paste `AGENT_SESSION_SECRET` into chat, PR bodies, issue comments, log files committed to the repo, or any markdown that could end up in a screenshot.
- Never paste the minted session cookie / JWT either — it grants admin access for 30 minutes and contains the user id.
- If you must reference the secret in a command, redact it in any output you echo back: `Bearer [REDACTED]`.
- If `cookies.txt` exists in the workspace, treat its contents as sensitive. Don't `cat` it into chat. Delete it when done.

## Quick mode

If the user says "log in as the agent" / "set up a browser session for testing" and the preconditions are clearly met (dev server running locally, `.env.local` has the keys, agent user previously seeded in this DB), skip the long preamble and just:

1. Confirm `http://localhost:3000/` returns 200/redirect.
2. Mint via the appropriate tool (curl / Playwright `context.request` / Chrome DevTools MCP `evaluate_script`).
3. Verify by hitting one protected route and checking it doesn't redirect to `/login`.

If anything in steps 1–3 fails, fall back to the full precondition check.
