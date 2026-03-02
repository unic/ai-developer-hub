# Research: AI Tool Access & Budget Tracker

**Branch**: `001-ai-tool-budget-tracker` | **Date**: 2026-03-02

---

## 1. Database: Drizzle ORM + Neon PostgreSQL on Vercel

### Decision
Use `@neondatabase/serverless` with `drizzle-orm/neon-serverless` (WebSocket/Pool adapter) as the primary driver.

### Rationale
Several user stories require multi-statement transactions (user deactivation with cascading license revocations per FR-007, budget allocation validation per FR-010, bulk user import with partial-success per FR-018). The WebSocket Pool adapter supports transactions natively, while the HTTP adapter does not. At this project's scale (500 users, 20 tools), the performance difference between WebSocket and HTTP is negligible.

### Alternatives Considered
| Alternative | Why Not |
|---|---|
| `neon-http` adapter only | Cannot do multi-statement transactions |
| `postgres` (node-postgres) directly | Doesn't use Neon's serverless driver; risks connection exhaustion |
| Prisma ORM | Larger bundle, slower cold starts, more opinionated than needed |
| Dual driver (HTTP + WebSocket) | Unnecessary complexity at this scale |

### Connection Pooling
- Use Neon's built-in PgBouncer pooler via the `-pooler` hostname suffix
- Client pool size: `max: 1` per serverless function instance
- Runtime: pooled connection string (`DATABASE_URL`)
- Migrations: direct/unpooled connection string (`DATABASE_URL_UNPOOLED`)

### Migration Strategy
- **Development**: `drizzle-kit push` for rapid iteration
- **CI/Staging/Production**: `drizzle-kit generate` → commit SQL migration files → `drizzle-kit migrate`
- Migrations run as a CI/CD step or pre-deploy script, never at app startup
- Migration files committed to `src/lib/db/migrations/`

### Performance Considerations
- Co-locate Neon and Vercel in the same AWS region (US East)
- Neon cold starts (300ms–3s) are acceptable at this scale (SC-003 allows 10s)
- Add indexes on: `users.email` (unique), `license_assignments.user_id`, `license_assignments.tool_id`, `license_assignments.status`, `budget_periods.budget_id`
- Drizzle ORM is ~50KB (fits within 150KB gzipped route budget)

---

## 2. Authentication: NextAuth.js (Auth.js v5)

### Decision
Use NextAuth.js (Auth.js v5) with the Credentials provider and the `@auth/drizzle-adapter`.

### Rationale
1. Native Next.js 15 App Router support — `auth()` works in Server Components, Server Actions, Route Handlers, and Middleware
2. Drizzle adapter keeps the database layer unified with existing Neon/Drizzle setup
3. Zero cost, minimal dependency (one package + adapter)
4. Role-based access is trivial: add `role` enum column to users table, inject into JWT session
5. For a single-tenant internal tool with admin-managed accounts, Credentials provider is appropriate and standard

### Role-Based Access Pattern
- Store `role` column (`admin` | `viewer`) on users table
- Middleware: protect all routes except `/login`, redirect unauthenticated users
- Server Actions: call `auth()`, check `session.user.role === "admin"` before mutations
- Pages: conditionally render admin-only UI in Server Components

### Alternatives Considered
| Alternative | Why Not |
|---|---|
| Clerk | Vendor dependency, user data sync complexity, overkill for internal tool, bundle size concerns |
| Custom auth (middleware + jose) | Unnecessary security risk and implementation effort for a solved problem |

---

## 3. UI: shadcn/ui + Tailwind CSS v4

### Decision
Use shadcn/ui with Tailwind CSS v4 (CSS-first config) and the following component set.

### Component Selection

**Data Display**: Table, Card, Badge, Separator, Skeleton
**Forms & Input**: Form (React Hook Form), Input, Textarea, Select, Combobox, Calendar/DatePicker, Switch
**Feedback & Overlays**: Dialog, Alert/AlertDialog, Toast (Sonner), Skeleton
**Navigation & Layout**: Sidebar, Breadcrumb, Tabs, DropdownMenu, Command
**Charts**: Chart components (built on Recharts)

### Rationale
- shadcn/ui copies component source into project — full ownership and customizability
- All components built on Radix UI primitives — keyboard navigable, ARIA-compliant (Constitution Principle IV)
- Tailwind CSS v4 is the default for new Next.js 15 projects; CSS-first config is simpler than JS config
- The shadcn CLI auto-detects Tailwind v4 and configures accordingly

### Alternatives Considered
| Alternative | Why Not |
|---|---|
| Tailwind CSS v3 | Migration debt for a greenfield project |
| Mantine UI | Own styling system, not Tailwind-native |
| Headless UI | Fewer components, no form/chart integration |

---

## 4. Charting: shadcn/ui Charts (Recharts)

### Decision
Use shadcn/ui's built-in Chart components (based on Recharts) for all budget and spending visualizations.

### Chart Types Planned
| Feature Area | Chart Type | Recharts Component |
|-------------|-----------|-------------------|
| Budget planned vs. actual | Grouped Bar Chart | `BarChart` |
| Spending trends over time | Area/Line Chart | `AreaChart` / `LineChart` |
| Per-tool cost breakdown | Pie/Donut Chart | `PieChart` |
| License utilization by tool | Horizontal Bar Chart | `BarChart` vertical layout |
| Budget forecast projection | Line Chart (dashed) | `LineChart` |

### Rationale
- Theme integration via CSS variables (auto light/dark support)
- Tree-shakeable — only import chart types needed
- Consistent with shadcn/ui design system (Constitution Principle II)

### Alternatives Considered
| Alternative | Why Not |
|---|---|
| Tremor | Own design system conflicts with shadcn/ui |
| Chart.js | Canvas-based, less accessible, no CSS variable theming |
| Nivo | Larger dependency, own theming system |
| Visx | Low-level, requires more code per chart |

---

## 5. Form Handling: React Hook Form + Zod + Server Actions

### Decision
Layered approach — React Hook Form + Zod for client-side validation UX, Server Actions + same Zod schemas for server-side validation and mutations.

### Architecture
```
Shared Zod schemas (src/lib/validators.ts)
├── Client: React Hook Form resolver → instant validation → calls Server Action
└── Server: Server Action → Zod.parse(formData) → Drizzle ORM → DB
```

### Rationale
1. shadcn/ui's Form component is built specifically for React Hook Form + Zod
2. Single Zod schema shared between client and server prevents validation drift
3. Complex forms (budget allocations, bulk import) benefit from RHF's field arrays and watch
4. Server Actions eliminate need for a separate REST API layer

### Alternatives Considered
| Alternative | Why Not |
|---|---|
| Server Actions only (useActionState) | No instant client-side validation, poor UX for complex forms |
| tRPC | Adds separate API paradigm alongside Server Actions, unnecessary complexity |
| Conform | shadcn/ui Form components not built for Conform |

---

## 6. Data Tables: TanStack Table v8

### Decision
Use TanStack Table v8 with shadcn/ui Table components, client-side sorting/filtering/pagination.

### Features Required
- Sorting (users by name/department, tools by cost)
- Filtering (by department, vendor, status)
- Pagination (up to 500 users)
- Row selection (bulk license revocation, bulk user operations)
- Global search (FR-003)
- Column visibility toggle

### Rationale
At 500 users / 20 tools scale, client-side operations are sufficient. Fetch all data in Server Components, pass to client DataTable component. Server-side pagination is unnecessary and adds complexity.

### Alternatives Considered
| Alternative | Why Not |
|---|---|
| AG Grid | Commercial license, own styling, overkill |
| Server-side TanStack Table | Unnecessary complexity at 500-row scale |
| Plain HTML tables | No sorting/filtering/pagination/selection built-in |

---

## 7. Testing Strategy (RESOLVED — was NEEDS CLARIFICATION)

### Decision
Five-layer testing stack using Vitest, Playwright, axe-core, and Lighthouse CI.

| Layer | Tool | Scope |
|-------|------|-------|
| Unit | Vitest + React Testing Library | Validators, utils, business logic, sync components |
| Integration | Vitest (separate config, real Neon DB) | Server Actions against DB, Drizzle queries, migrations |
| E2E | Playwright | Full user flows, async Server Components, auth |
| A11y | @axe-core/playwright | WCAG 2.1 AA on all pages (runtime) |
| Performance | @lhci/cli (Lighthouse CI) | LCP/INP/CLS budgets, performance scores |

### Additional Static Checks
- `eslint-plugin-jsx-a11y` for JSX-level a11y violations at lint time
- TypeScript strict compilation (`tsc --noEmit`)
- ESLint with zero warnings

### CI Pipeline Order
1. `tsc --noEmit` → TypeScript gate
2. `eslint . --max-warnings 0` → Lint gate
3. `vitest run` → Unit test gate
4. `vitest run --config vitest.config.integration.mts` → Integration test gate
5. In parallel:
   - `playwright test` → E2E + a11y gate
   - `lhci autorun` → Lighthouse gate

### Rationale
- Vitest over Jest: native ESM/TS support, faster, fewer dependencies, Jest-compatible API
- Playwright over Cypress: better performance, native multi-browser, cleaner Next.js integration
- axe-core/playwright: Deque's official Playwright integration, runs in real browser
- LHCI: Google's official CI tool for Lighthouse budget assertions

### New Dev Dependencies (Total: ~10 packages)
`vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/dom`, `vite-tsconfig-paths`, `@playwright/test`, `@axe-core/playwright`, `@lhci/cli`, `eslint-plugin-jsx-a11y`

---

## 8. Dependency Summary

### Production Dependencies
| Package | Purpose |
|---------|---------|
| `next` | Framework (App Router, Server Components, Server Actions) |
| `react`, `react-dom` | UI library |
| `@neondatabase/serverless` | Neon PostgreSQL serverless driver |
| `drizzle-orm` | Type-safe ORM |
| `next-auth@5` | Authentication (Auth.js v5) |
| `@auth/drizzle-adapter` | NextAuth ↔ Drizzle integration |
| `zod` | Schema validation (shared client/server) |
| `react-hook-form` | Client-side form management |
| `@hookform/resolvers` | Zod resolver for RHF |
| `recharts` | Charts (via shadcn/ui Chart components) |
| `@tanstack/react-table` | Headless data table logic |
| `bcryptjs` | Password hashing for credentials auth |

### Dev Dependencies
| Package | Purpose |
|---------|---------|
| `typescript` | Language |
| `tailwindcss` | Styling (v4) |
| `drizzle-kit` | Schema migrations |
| `eslint`, `prettier` | Linting and formatting |
| `vitest`, `@vitejs/plugin-react`, `jsdom` | Unit/integration testing |
| `@testing-library/react`, `@testing-library/dom` | Component testing |
| `vite-tsconfig-paths` | Vitest path alias resolution |
| `@playwright/test` | E2E testing |
| `@axe-core/playwright` | Accessibility testing |
| `@lhci/cli` | Lighthouse CI |
| `eslint-plugin-jsx-a11y` | Static a11y linting |

### shadcn/ui Components (copied, not installed)
Table, Card, Badge, Form, Input, Textarea, Select, Combobox, Calendar, Switch, Dialog, Alert, AlertDialog, Toast/Sonner, Skeleton, Sidebar, Breadcrumb, Tabs, DropdownMenu, Command, Chart, Button, Label, Separator
