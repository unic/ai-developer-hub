# Quickstart: AI Tool Access & Budget Tracker

**Branch**: `001-ai-tool-budget-tracker` | **Date**: 2026-03-02

---

## Prerequisites

- **Node.js**: LTS (v20+)
- **pnpm**: v9+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Neon account**: Free tier at [neon.tech](https://neon.tech)
- **Vercel account**: For deployment (optional for local dev)

---

## Local Setup

### 1. Create Next.js Project

```bash
pnpm create next-app@latest . --typescript --tailwind --eslint --app --src-dir --use-pnpm
```

Select defaults for all prompts. This scaffolds Next.js 15 with Tailwind v4 and App Router.

### 2. Install Dependencies

```bash
# Production
pnpm add @neondatabase/serverless drizzle-orm next-auth@5 @auth/drizzle-adapter zod react-hook-form @hookform/resolvers recharts @tanstack/react-table bcryptjs

# Dev
pnpm add -D drizzle-kit @types/bcryptjs vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom vite-tsconfig-paths @playwright/test @axe-core/playwright @lhci/cli eslint-plugin-jsx-a11y prettier

# Playwright browsers
pnpm exec playwright install chromium
```

### 3. Initialize shadcn/ui

```bash
pnpm dlx shadcn@latest init
```

Accept defaults (New York style, neutral base color, CSS variables). Then add required components:

```bash
pnpm dlx shadcn@latest add button card input label select textarea table form dialog alert alert-dialog badge tabs sidebar breadcrumb dropdown-menu command skeleton switch calendar chart separator toast
```

### 4. Configure Neon Database

1. Create a new Neon project at [console.neon.tech](https://console.neon.tech)
2. Select **AWS US East** region (to match Vercel default)
3. Copy the connection strings

Create `.env.local`:

```env
# Neon PostgreSQL
DATABASE_URL="postgresql://user:pass@ep-xyz-pooler.us-east-2.aws.neon.tech/dbname?sslmode=require&pgbouncer=true"
DATABASE_URL_UNPOOLED="postgresql://user:pass@ep-xyz.us-east-2.aws.neon.tech/dbname?sslmode=require"

# NextAuth
AUTH_SECRET="generate-with-openssl-rand-base64-32"
NEXTAUTH_URL="http://localhost:3000"
```

### 5. Configure Drizzle

Create `drizzle.config.ts`:

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './src/lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_UNPOOLED!,
  },
});
```

### 6. Configure TypeScript Strict Mode

Ensure `tsconfig.json` has:

```json
{
  "compilerOptions": {
    "strict": true
  }
}
```

### 7. Run Database Migrations

```bash
# During development (direct schema push)
pnpm drizzle-kit push

# For staging/production (generate migration files)
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

### 8. Seed Admin User

Create and run a seed script to create the first admin user:

```bash
pnpm tsx src/lib/db/seed.ts
```

### 9. Start Development Server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Login with the seeded admin credentials.

---

## Package.json Scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint && eslint . --max-warnings 0",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit",
    "db:push": "drizzle-kit push",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:seed": "tsx src/lib/db/seed.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration": "vitest run --config vitest.config.integration.mts",
    "test:e2e": "playwright test",
    "test:a11y": "playwright test --grep @a11y",
    "lighthouse": "lhci autorun"
  }
}
```

---

## Vercel Deployment

### 1. Link to Vercel

```bash
pnpm i -g vercel
vercel link
```

### 2. Configure Environment Variables

In Vercel project settings, add:
- `DATABASE_URL` (pooled Neon connection string)
- `DATABASE_URL_UNPOOLED` (direct Neon connection string)
- `AUTH_SECRET` (random 32-byte base64 string)

### 3. Deploy

```bash
vercel --prod
```

Or push to the linked Git repository for automatic deployments.

---

## CI Gates Checklist

These must pass before any PR is merged (per constitution):

1. `pnpm typecheck` — TypeScript compilation, zero errors
2. `pnpm lint` — ESLint, zero warnings
3. `pnpm format:check` — Prettier formatting
4. `pnpm test` — Unit tests passing
5. `pnpm test:integration` — Integration tests passing
6. `pnpm test:e2e` — E2E + a11y tests passing
7. `pnpm lighthouse` — Lighthouse performance budgets met
