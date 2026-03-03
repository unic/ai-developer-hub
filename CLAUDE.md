# AI Developer Hub Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-03-02

## Active Technologies
- TypeScript 5.x (strict mode), Node.js LTS + Next.js 15 (App Router), Tailwind CSS v4, shadcn/ui (new-york style), React Hook Form, Zod, TanStack Table v8, Recharts, Lucide React (001-ai-tool-budget-tracker)
- Neon PostgreSQL serverless via Drizzle ORM (001-ai-tool-budget-tracker)

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
- 001-ai-tool-budget-tracker: Added TypeScript 5.x (strict mode), Node.js LTS + Next.js 15 (App Router), Tailwind CSS v4, shadcn/ui (new-york style), React Hook Form, Zod, TanStack Table v8, Recharts, Lucide React

- **001-ai-tool-budget-tracker**: AI tool license tracking, user management, budget planning with Neon PostgreSQL

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
