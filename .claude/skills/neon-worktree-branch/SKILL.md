---
name: neon-worktree-branch
description: This skill should be used when working inside a git worktree (path contains `.claude/worktrees/` or `worktrees/`) and about to apply schema changes, run migrations (`pnpm db:push`, `pnpm db:migrate`, `drizzle-kit push`, `prisma migrate`), or perform destructive data operations against a Neon Postgres database. Also triggers when the user asks to "branch the database", "create a database branch", "isolate the DB for this worktree", "fork the DB", or troubleshoots accidentally writing to production data from a worktree. Creates an isolated Neon branch, swaps the worktree's `DATABASE_URL` (and `DATABASE_URL_UNPOOLED`) to point at it, and cleans up when the worktree is merged or abandoned. **Safety guarantee**: the skill refuses to run migrations until the worktree's DB is verifiably on a `wt/*` branch (never the default / production branch), and refuses to delete the default branch under any circumstances.
---

# Neon database branch for a git worktree

Create a copy-on-write Neon branch so schema changes and migrations in a worktree don't touch the production / shared database. Neon branches are instant and free; the only durable side effect is a row in the project's branch list until cleanup.

## Safety rails (mandatory — never relax)

These rules are non-negotiable. They prevent this skill — and any migration command run while this skill is loaded — from touching production data.

1. **Never migrate while pointed at the default branch.** Before any `pnpm db:push` / `pnpm db:migrate` / `drizzle-kit push` / `prisma migrate` runs from a worktree, the skill MUST verify the active `DATABASE_URL` host resolves to a Neon branch whose name starts with `wt/` AND whose id is NOT the default branch id from `describe_project`. If either check fails, **abort with a hard error**. Do not "try anyway", do not auto-create a branch on the fly without going through the full skill flow with user confirmation.
2. **Never delete the default branch.** `delete_branch` MUST only be called when ALL of these hold: (a) the branch name starts with `wt/`, (b) the branch id is NOT equal to the default branch id from `describe_project`, (c) the user has confirmed deletion of that specific branch name in this session. If any check fails, refuse and surface the reason to the user.
3. **Never edit `.env.local` outside a worktree.** The path passed to Edit MUST contain `worktrees/` (or `.claude/worktrees/`). Reject any swap that would write to the main repo's `.env.local`.
4. **Never restore production credentials into a worktree without explicit user instruction.** After branch deletion, do NOT auto-rewrite `DATABASE_URL` back to the production URL. Leave the worktree in a broken-DB state (or delete it entirely) — that's safer than silently re-pointing at production where the next casual command could write.
5. **Never run a migration command yourself unless the user just asked for it in this turn.** Schema files changing in a Diff is NOT permission to run `db:push`. The skill creates a safe environment; the user pulls the trigger.
6. **No fallback path that talks to the DB directly.** If the Neon MCP is not connected, stop and tell the user. Do not invent an alternative via `neonctl`, raw HTTP, or `psql` to "make it work" — those bypass these safety rails.
7. **Mask connection strings in all output.** Never print the password component to the user; always mask as `postgresql://<role>:***@<host>/<db>?sslmode=require`. This is a habit, not just a privacy rule — it prevents a copy-paste of a production URL into a misclick.

Each substantive section below has an explicit verification step that enforces one of these rails. Do not skip them, even when the user is in a hurry.

## When to trigger

- The current working directory contains `worktrees/` or `.claude/worktrees/` **and** the user is about to run `pnpm db:push`, `pnpm db:migrate`, `pnpm db:generate` with intent to apply, `drizzle-kit push`, or any direct migration / DDL.
- The user explicitly asks to branch / fork / isolate the database for this worktree.
- The agent (or user) realizes a destructive operation just ran (or is about to run) against the *shared* `DATABASE_URL` that was copied from the main checkout into the worktree's `.env.local`.

If the user is in the main repo checkout (not a worktree), do not silently branch — surface the risk and ask first. The skill assumes worktree isolation is the goal.

## Required tools

The Neon MCP server must be connected. The relevant deferred tools are:

- `mcp__plugin_neon_neon__list_projects`
- `mcp__plugin_neon_neon__describe_project`
- `mcp__plugin_neon_neon__create_branch`
- `mcp__plugin_neon_neon__get_connection_string`
- `mcp__plugin_neon_neon__describe_branch`
- `mcp__plugin_neon_neon__delete_branch`

Load schemas via `ToolSearch` with `query: "select:mcp__plugin_neon_neon__list_projects,mcp__plugin_neon_neon__create_branch,mcp__plugin_neon_neon__get_connection_string,mcp__plugin_neon_neon__delete_branch,mcp__plugin_neon_neon__describe_project"` before invoking.

If the Neon MCP is not available, **stop**. Do not attempt a workaround via `neonctl` or raw HTTP — explain to the user that the Neon MCP server is required for this skill and that they can connect it via the Vercel/Neon integration in Claude Code.

## Identify project + parent branch (pre-flight)

1. **Read the worktree's `.env.local`** with the Read tool. Confirm a `DATABASE_URL=postgresql://...neon.tech/...` is present. Extract the host substring — Neon project IDs appear in the host as `ep-<adjective>-<noun>-<id>` or as part of the project subdomain. Do **not** print the full URL back to the user.
2. Call `list_projects` to find the candidate project. Match against the host. If multiple projects could match, ask the user which one.
3. Call `describe_project` for the chosen project. Note:
   - The **default branch ID** (parent for the new branch — usually `production` or `main`).
   - Existing branches whose name collides with the worktree (handle below).

## Choose a branch name

Use the **worktree directory name**, not the git branch (multiple worktrees may share a git branch, and git branch names can contain slashes that Neon doesn't allow):

```
wt/<worktree-dir-name>
```

For this project family, examples: `wt/claude-dashboard`, `wt/copilot-billing-fix`.

If a branch with that name already exists in `describe_project`'s output, **do not auto-recreate it**. Ask the user whether to reuse the existing branch (just refresh the `DATABASE_URL`) or delete + recreate (destroys whatever state was in it).

## Create the branch

Call `create_branch` with:
- `project_id`: the matched project's id
- `branch_name`: the chosen `wt/<dir>` name
- `parent_id`: the default branch id from `describe_project` (so the new branch forks from current production state, not from a stale earlier branch)

The call returns the new branch's id and the auto-provisioned compute endpoint. If the response is missing a compute endpoint, call `list_branch_computes` to confirm one was created (Neon usually auto-creates a read-write compute for new branches; if not, surface to the user).

## Pull the connection strings

Neon issues two URLs per branch — pooled (for serverless / `@neondatabase/serverless`) and unpooled (for direct migrations). Most Next.js projects use the pooled URL at runtime and the unpooled URL for `drizzle-kit` migrations.

Call `get_connection_string` **twice** (or once and check the response shape):
1. `pooled: true` → assign to `DATABASE_URL`
2. `pooled: false` → assign to `DATABASE_URL_UNPOOLED`

Use the database name from the original `DATABASE_URL` (typically `neondb` for Neon defaults). Use the role from the original URL (typically `neondb_owner`).

**Never print the full connection string** to the user output. When confirming the swap, mask the password: `postgresql://neondb_owner:***@ep-...-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require`.

## Swap the worktree's `.env.local`

Use the Edit tool — **not** Write — so existing comments and unrelated env vars are preserved.

1. **Path check (Rail #3)** — confirm the file path passed to Edit contains `worktrees/` or `.claude/worktrees/`. If not, abort: this skill must never edit the main checkout's `.env.local`.
2. Replace the line starting with `DATABASE_URL=` with the new pooled URL.
3. Replace the line starting with `DATABASE_URL_UNPOOLED=` with the new unpooled URL. If that key doesn't exist yet, add it on a new line immediately after `DATABASE_URL`.
4. Leave every other line untouched.

### Post-swap verification (mandatory — enforces Rail #1)

Immediately after the edit, **re-Read** the worktree's `.env.local` and verify all of the following before declaring success:

1. `DATABASE_URL` exists and its host substring contains the new branch's host fragment returned by `get_connection_string`.
2. `DATABASE_URL`'s host does NOT match the default branch's host from `describe_project`. (Defensive: if `get_connection_string` ever returned the wrong URL, this catches it.)
3. The branch id encoded in the host corresponds to the `wt/<dir>` branch you just created — cross-reference against `describe_branch` or the response from `create_branch`.

If any of these fail, **revert the Edit** by writing the original `DATABASE_URL` value back and tell the user: "Branch swap failed verification — worktree is still on the original DB. Do not run migrations until this is resolved." Then stop. Do not retry silently.

When verification passes, confirm with the user in plaintext (masked URL only): "Worktree DATABASE_URL now points at Neon branch `wt/<dir>` (parent: `production`). Restart any running dev servers."

## Restart the dev server

If a `pnpm dev` is already running in the background (check via Bash output files or running processes), the new env vars won't be picked up. Kill the running process and start a new one. The user should not have to do this manually if you started the dev server yourself.

## Apply migrations against the branch

### Pre-flight gate (mandatory — enforces Rail #1 + Rail #5)

Before running ANY migration command, run this in-context check. Even if you "know" the swap succeeded.

1. Re-Read the worktree's `.env.local` (do not trust memory of what was written earlier; the user may have edited it).
2. Extract the host of `DATABASE_URL`. Compare against the default branch host from `describe_project` (cached from the create-branch step, or re-fetched).
3. Verify the host belongs to a branch whose name starts with `wt/`. If `describe_project` doesn't surface branch-name-to-host mapping directly, call `describe_branch` for the suspected branch id and confirm name and id.

If the host matches the default branch host, or the branch name does not start with `wt/`, **abort**. Tell the user: "Refusing to run migrations — worktree appears to still be pointing at the production / default Neon branch. Run the `neon-worktree-branch` skill from scratch." Do not run migrations.

### Confirm user intent (Rail #5)

Migration commands change schema and can drop data. They must be triggered by an explicit in-turn user request ("run db:push", "apply the migration", "let's migrate") — not by the agent observing that `src/lib/db/schema.ts` changed. If the user has not explicitly asked, do not run them yourself. Surface the diff and the suggested command instead.

### Run

When the gate passes AND the user has explicitly asked:

```
pnpm db:push        # for Drizzle schema sync (dev)
pnpm db:generate    # to author migration files (safe — no DB writes)
pnpm db:migrate     # to apply migrations against the branch
```

These will hit the Neon branch via the swapped URL. Confirm with a cheap query immediately after the first migration:

```
psql "$DATABASE_URL_UNPOOLED" -c "select current_database(), current_user, now(), inet_server_addr();"
```

Or via the project's own DB connection helper if `psql` isn't installed. The point is to confirm "schema landed on the branch, not on production" before doing any real work. The result's host fingerprint should still match the `wt/*` branch.

## When the worktree is merged or abandoned

After the worktree's git branch is merged into `main` (or the worktree is discarded), the Neon branch can be deleted. This is the only path in this skill that calls a destructive Neon API; it gets the strictest gates.

### Pre-delete checks (mandatory — enforces Rail #2)

All of the following MUST be true before calling `delete_branch`:

1. **Explicit user request in this turn.** The user has said "delete the Neon branch", "drop the branch", "worktree is done — clean up", or similar — in this session, not a stale earlier intent. Never auto-prune on session start.
2. **Name starts with `wt/`.** Re-fetch the branch via `describe_branch` and verify `name.startsWith("wt/")`. Refuse to delete branches with any other name pattern — they were not created by this skill.
3. **ID is NOT the default branch id.** From `describe_project`, get the default branch id. The branch you intend to delete must not equal it. (Belt-and-braces: Neon's own API also rejects deleting the protected/default branch, but do not rely on that.)
4. **Name matches what the user named.** Echo the exact branch name back to the user ("Delete Neon branch `wt/claude-dashboard`? This is irreversible.") and wait for an unambiguous yes. Do not pattern-match "ok"/"yeah" mid-other-conversation; require a clear confirmation tied specifically to the branch name.
5. **No active connection from the dev server.** If a `pnpm dev` is still running against the branch URL, it will start erroring as soon as the branch goes away. Stop the dev server first or warn the user.

If any check fails, refuse and surface the reason. Do not "try the delete anyway" hoping the Neon API will reject it.

### Delete

When all checks pass:

1. Call `delete_branch` with the matched project id and branch id.
2. Confirm success by listing branches (`describe_project` again) and verifying the branch is gone.
3. **Do NOT restore production credentials into the worktree's `.env.local`** (Rail #4). Leave it with the stale branch URL (or empty), which will cause an obvious connection-refused error if anything tries to use the DB from the worktree afterward — that is the desired behavior, since the worktree is being torn down. If the user explicitly asks to re-point the worktree at production, treat it as a separate, explicit request and warn them clearly first.

Do **not** auto-delete the branch on every cleanup — only when the user explicitly says the worktree is done.

## Caveats and known gotchas

- **`.env.local` is gitignored.** The branched `DATABASE_URL` does not travel with the worktree. If a colleague pulls the same worktree branch, they will still be on the shared `DATABASE_URL` until they run this skill themselves.
- **Don't reuse branches across worktrees.** If two worktrees share a Neon branch, schema changes in one will surprise the other. Name the branch after the worktree dir, always.
- **Drizzle `db:push` is dev-only.** It applies the current TS schema directly to the DB without producing a migration file. That's fine for branch isolation but means the change must still be captured via `db:generate` + committed before merging back to main. Confirm with the user which mode they want for the worktree.
- **Neon free tier branch limits.** Free Neon projects cap branches per project. If `create_branch` fails with a quota error, prompt the user to delete stale `wt/*` branches from older worktrees rather than auto-pruning.
- **Don't branch from a non-default parent unless asked.** Forking from another `wt/*` branch (a fork of a fork) is supported by Neon but rarely what the user wants — it propagates schema state from one worktree into another. Default to the production branch.
- **Pooled vs unpooled for serverless.** `@neondatabase/serverless` works with both, but the pooled URL is required when you exceed simple per-request connection counts. Drizzle migrations need the unpooled URL because pgbouncer doesn't support some statements migrations issue. Always provide both.

## Quick mode (state already good)

If the user asks "are we on a branched DB?" or "am I safe to migrate?", check current state in one Read + one MCP call:

1. Read the worktree's `.env.local`, extract the host portion of `DATABASE_URL`.
2. Call `describe_project` and compare the host substring against branch ids in the response.

Outcomes:
- Host matches a `wt/<dir>` branch → "Yes, on branch `wt/<dir>` — safe to migrate."
- Host matches the default branch → "**No — still on production. Refusing to run migrations from this worktree until the full skill has branched the DB.**"
- Host doesn't match any known Neon branch → "Worktree env points at an unknown database. Refusing to run migrations until the user confirms what this database is and that it is safe to write to."

In the latter two cases, do NOT silently proceed. Do NOT attempt a "best-effort" branch creation without going through the full skill flow with user confirmation.

## Out of scope (and explicitly refused)

- **Branching Neon for the main repo checkout (not a worktree).** Default to refusing. The skill's safety model assumes the worktree pattern. If the user explicitly insists on branching for a migration spike in main, surface the risk clearly: future `pnpm db:push` runs from main will keep hitting the branch until they restore the env — which is an easy way to forget and silently corrupt prod schema. Strongly prefer asking them to create a worktree first.
- **Promoting a branch to production.** Neon supports this via the console but this skill MUST NOT do it. That's a deploy-time decision with downtime/migration-replay implications; it belongs in a release process, not in a worktree cleanup.
- **Editing the production branch directly.** No write path in this skill targets the default branch. If the user asks the skill to "apply this migration to prod", refuse and direct them to the actual deploy process.
- **Non-Neon Postgres (Supabase, RDS, self-hosted).** The branching MCP tools don't exist for these; the skill does not apply. Suggest a separate `.env.local` with a manually provisioned dev DB, or `pg_dump`/`pg_restore` into a local Postgres for isolation. Do NOT attempt to simulate branching by copying schema with raw `psql` against an unknown URL — that's exactly the path that ends in writing to production.
- **Any path that bypasses the rails above.** If the user asks for an "exception just this once", the answer is no. The rails exist because the cost of being wrong (production schema corruption, dropped data) is asymmetric with the cost of asking the user to slow down for 30 seconds. If they truly need to talk to production, they should do it from the main checkout, with an explicit one-off command they typed themselves — not via this skill.
