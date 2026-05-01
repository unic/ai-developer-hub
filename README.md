# AI Developer Hub

A Next.js application for tracking AI tool budgets, managing licenses, and monitoring usage costs across your organisation.

## CI

Every pull request and push to `main` runs the full quality gate via **GitHub Actions** (`.github/workflows/ci.yml`):

| Job | What it checks |
|-----|----------------|
| **Lint & Typecheck** | ESLint (zero warnings) + TypeScript strict compilation |
| **Unit Tests** | Vitest unit test suite (`tests/unit/`) |
| **Build** | `next build` with stub environment variables |

Integration tests and E2E tests (Playwright) are defined as commented-out placeholders in the workflow file — see the inline comments for the secrets and infrastructure they require.

> **Branch protection**: To enforce these checks as merge requirements, enable *Require status checks to pass before merging* in **Settings → Branches → Branch protection rules** and add `Lint & Typecheck`, `Unit Tests`, and `Build` as required status checks.

## Getting started

### Prerequisites

- Node.js 20 (see `.nvmrc`)
- pnpm 10
- A [Neon](https://neon.tech) PostgreSQL database

### Environment variables

Copy `.env.local.example` to `.env.local` and fill in the values:

```bash
cp .env.local.example .env.local
```

See `.env.local.example` for the full list of required variables and where to obtain each one.

### Development

```bash
pnpm install
pnpm db:push    # push schema to dev DB
pnpm db:seed    # seed initial admin user
pnpm dev        # start dev server at http://localhost:3000
```

### Quality checks

```bash
pnpm lint        # ESLint
pnpm typecheck   # TypeScript
pnpm test        # Unit tests (Vitest)
pnpm build       # Production build
```

### Database

```bash
pnpm db:generate   # generate Drizzle migration files
pnpm db:migrate    # apply migrations
pnpm db:push       # push schema directly to dev DB (no migrations)
```
