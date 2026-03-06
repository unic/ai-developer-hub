# AI Developer Hub Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-02

## Active Technologies
- TypeScript 5.x (strict mode), Node.js LTS + Next.js 15 (App Router), Tailwind CSS v4, shadcn/ui (new-york style), React Hook Form, Zod, TanStack Table v8, Recharts, Lucide React (001-ai-tool-budget-tracker)
- Neon PostgreSQL serverless via Drizzle ORM (001-ai-tool-budget-tracker)
- TypeScript 5.x (strict mode), React 19, Node.js LTS + Next.js 15.5.12 (App Router), Tailwind CSS 4.2.1, shadcn/ui (new-york style), next-themes 0.4.6, Lucide React 0.576.0, class-variance-authority (002-retro-glitch-themes)
- Neon PostgreSQL via Drizzle ORM (user preferences), localStorage (unauthenticated preference fallback) (002-retro-glitch-themes)
- TypeScript 5.9.3 (strict mode), Node.js LTS, React 19.2.4 + Next.js 15.5.12 (App Router), Drizzle ORM 0.45.1, next-auth 5.0.0-beta.30, shadcn/ui + radix-ui, React Hook Form 7.71.2, Zod 4.3.6, TanStack Table 8.21.3, Recharts 2.15.4, date-fns 4.1.0, react-day-picker 9.14.0 (003-enhance-core-features)
- Neon PostgreSQL (serverless) via @neondatabase/serverless 1.0.2 (003-enhance-core-features)
- TypeScript 5.9.3 (strict mode) + Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, next-auth 5.0.0-beta.30, shadcn/ui + radix-ui, React Hook Form 7.71.2, Zod 4.3.6, date-fns 4.1.0, bcryptjs, sonner (toasts) (004-bulk-license-import)
- Neon PostgreSQL (serverless) via @neondatabase/serverless 1.0.2 + Drizzle ORM (004-bulk-license-import)
- TypeScript 5.9.3 (strict mode), Node.js LTS + Next.js 15.5.12 (App Router), Recharts 2.15.4 (already installed), shadcn/ui ChartContainer, Drizzle ORM 0.45.1, next-auth 5.0.0-beta.30 (005-rich-reports)
- Neon PostgreSQL (serverless) — no schema changes; all report data derived from `annual_budgets`, `budget_periods`, `billed_costs`, `license_assignments`, `ai_tools` (005-rich-reports)
- TypeScript 5.9.3 (strict mode), Node.js LTS + Next.js 15.5.12 (App Router), Drizzle ORM 0.45.1, Zod 4.3.6, React Hook Form 7.71.2, TanStack Table 8.21.3, shadcn/ui (new-york style), Lucide React, Sonner (toasts) (006-optional-fields-ux)
- Neon PostgreSQL (serverless) via `@neondatabase/serverless` (006-optional-fields-ux)
- TypeScript 5.9.3 (strict mode), Node.js LTS + Next.js 15.5.12 (App Router), Drizzle ORM 0.45.1, Zod 4.3.6, React Hook Form 7.71.2, TanStack Table 8.21.3, shadcn/ui (new-york), Sonner (toasts), `unzipper` (NEW — zip extraction) (007-invoice-budget-link)
- Neon PostgreSQL (serverless) via `@neondatabase/serverless` + Cloudflare R2 (PDF blobs) (007-invoice-budget-link)
- TypeScript 5.9.3 (strict mode), React 19.2.4, Next.js 15.5.12 (App Router) + Tailwind CSS 4.2.1, shadcn/ui (new-york), next-themes 0.4.6, Recharts 2.15.4, class-variance-authority (010-pro-dashboard-theme)
- Neon PostgreSQL via Drizzle ORM (minor schema default change for UserPreferences) (010-pro-dashboard-theme)

- **Language**: TypeScript 5.x (strict mode), Node.js LTS
- **Framework**: Next.js 15 (App Router, Server Components, Server Actions)
- **Styling**: Tailwind CSS v4, shadcn/ui component library
- **ORM**: Drizzle ORM with Neon PostgreSQL serverless
- **Auth**: NextAuth.js v5 (Auth.js) with Credentials provider + Drizzle adapter
- **Validation**: Zod (shared client/server schemas)
- **Forms**: React Hook Form + @hookform/resolvers
- **Data Tables**: TanStack Table v8
- **Charts**: Recharts (via shadcn/ui Chart components)
- **Testing**: Vitest (unit/integration), Playwright (e2e + a11y), @lhci/cli (Lighthouse CI)
- **Package Manager**: pnpm

## Project Structure

```text
src/
├── app/                        # Next.js App Router pages and layouts
├── components/ui/              # shadcn/ui components
├── lib/
│   ├── db/                     # Drizzle schema, connection, migrations
│   ├── auth.ts                 # NextAuth configuration
│   ├── validators.ts           # Shared Zod schemas
│   └── utils.ts                # General utilities
├── actions/                    # Server Actions (business logic)
└── types/                      # Shared TypeScript types

tests/
├── unit/                       # Vitest unit tests
├── integration/                # Vitest integration tests (real DB)
└── e2e/                        # Playwright E2E tests
```

## Commands

```bash
pnpm dev               # Start dev server
pnpm build             # Production build
pnpm lint              # ESLint (zero warnings)
pnpm typecheck         # TypeScript strict compilation
pnpm format            # Prettier format
pnpm db:push           # Push schema to dev DB
pnpm db:generate       # Generate migration files
pnpm db:migrate        # Apply migrations
pnpm db:seed           # Seed initial admin user
pnpm test              # Unit tests (Vitest)
pnpm test:integration  # Integration tests (real DB)
pnpm test:e2e          # E2E tests (Playwright)
pnpm lighthouse        # Lighthouse CI
```

## Code Style

- TypeScript strict mode — no `any` without justification comment
- Monetary values stored as integers (cents) — never floating-point
- Server Actions return `{ success: true, data } | { success: false, error }`
- Shared Zod schemas in `src/lib/validators.ts` for client+server validation
- shadcn/ui components for all UI primitives — no ad-hoc styling
- Tailwind CSS design tokens only — no hardcoded color/spacing values
- Server Components by default — `"use client"` only when client interactivity needed

## Recent Changes
- 010-pro-dashboard-theme: Added TypeScript 5.9.3 (strict mode), React 19.2.4, Next.js 15.5.12 (App Router) + Tailwind CSS 4.2.1, shadcn/ui (new-york), next-themes 0.4.6, Recharts 2.15.4, class-variance-authority
- 007-invoice-budget-link: Added TypeScript 5.9.3 (strict mode), Node.js LTS + Next.js 15.5.12 (App Router), Drizzle ORM 0.45.1, Zod 4.3.6, React Hook Form 7.71.2, TanStack Table 8.21.3, shadcn/ui (new-york), Sonner (toasts), `unzipper` (NEW — zip extraction)
- 006-optional-fields-ux: Added TypeScript 5.9.3 (strict mode), Node.js LTS + Next.js 15.5.12 (App Router), Drizzle ORM 0.45.1, Zod 4.3.6, React Hook Form 7.71.2, TanStack Table 8.21.3, shadcn/ui (new-york style), Lucide React, Sonner (toasts)
- 009-invoice-syncing: Added TypeScript 5.9.3 (strict mode) + Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, Zod 4.3.6, shadcn/ui, Sonner (toasts), Lucide React
- 008-invoice-duplicate-handling: Added TypeScript 5.9.3 (strict mode) + Next.js 15.5.12 (App Router), React 19.2.4, Drizzle ORM 0.45.1, React Hook Form 7.71.2, Zod 4.3.6, TanStack Table 8.21.3, shadcn/ui, Sonner (toasts), @aws-sdk/client-s3 (R2)
- 007-invoice-budget-link: Added TypeScript 5.9.3 (strict mode), Node.js LTS + Next.js 15.5.12 (App Router), Drizzle ORM 0.45.1, Zod 4.3.6, React Hook Form 7.71.2, TanStack Table 8.21.3, shadcn/ui (new-york), Sonner (toasts), `unzipper` (NEW — zip extraction)


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
