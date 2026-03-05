# Quickstart: Enhance Core Features

**Branch**: `003-enhance-core-features`

## Prerequisites

- Node.js LTS installed
- pnpm installed (`npm install -g pnpm`)
- Neon PostgreSQL database provisioned (connection string in `.env.local`)
- Existing `001-ai-tool-budget-tracker` and `002-retro-glitch-themes` features deployed

## Setup

```bash
# 1. Switch to feature branch
git checkout 003-enhance-core-features

# 2. Install dependencies (no new packages required)
pnpm install

# 3. Add API key encryption secret to .env.local
echo 'API_KEY_ENCRYPTION_SECRET="<generate-32-random-bytes-base64>"' >> .env.local
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 4. Apply database migrations
pnpm db:migrate

# 5. Start development server
pnpm dev
```

## Verification Steps

### 1. Column Rename (Department → Circle)

```bash
# Verify migration applied
pnpm db:push  # Should show no pending changes

# Check TypeScript compiles
pnpm typecheck
```

- Open `/users` → table column should say "Circle"
- Open `/users/new` → form field should say "Circle"
- Open `/reports` → grouping should say "Circle"

### 2. Unauthenticated Sidebar

- Open app in incognito → sidebar visible with branding and "Sign In" button
- Click "Sign In" → redirected to `/login`
- Navigate to `/users` while logged out → "Authentication Required" card in content area
- Sign in → redirected back to originally requested page

### 3. Role-Based Navigation

- Log in as **admin** → sidebar shows: Dashboard, Tools, Users, Assignments, Budget, Reports, Settings
- Log in as **viewer** → sidebar shows: Dashboard, Assignments, Settings
- As viewer, navigate to `/users` directly → "Access Denied" message
- As viewer, open Dashboard → personalized metrics (own tools, own costs)

### 4. Tier Editing

- Navigate to `/tools/{id}` → click edit on a tier
- Change monthly cost → save
- Check tool's change history → entry shows old/new cost, who changed it, when

### 5. Assignment Editing

- Navigate to `/assignments` → click edit on an active assignment
- Change tier → verify cost snapshot updates
- Set retrospective date → verify date validation
- Add workspace and API key → verify masked display and reveal

### 6. Assignment Comments

- Open assignment detail view
- Add a comment → verify it appears with timestamp and author
- Add a second comment → verify chronological order

### 7. Billed Costs

- Navigate to `/budget/{id}`
- Click "Add billed cost" on a period
- Enter amount, invoice date, description → save
- Verify billed total, expected total, and variance display
- Try adding to an archived budget → should be blocked

## Key Files Modified

| Area | Primary files |
|------|--------------|
| DB Schema | `src/lib/db/schema.ts` |
| Migrations | `src/lib/db/migrations/` |
| Validators | `src/lib/validators.ts` |
| Types | `src/types/index.ts` |
| Encryption | `src/lib/crypto.ts` (new) |
| Auth Guard | `src/components/auth-guard.tsx` (new) |
| Sidebar | `src/components/app-sidebar.tsx` |
| Middleware | `src/middleware.ts` |
| Root Layout | `src/app/layout.tsx` |
| Assignments | `src/actions/assignments.ts`, `src/app/assignments/` |
| Budget | `src/actions/budget.ts`, `src/app/budget/` |
| Tools | `src/app/tools/[id]/tool-detail-client.tsx` |
| Users | `src/app/users/`, `src/actions/users.ts` |
| Reports | `src/app/reports/page.tsx` |
| CSV Import | `src/app/users/import/bulk-import-form.tsx` |

## Commands

```bash
pnpm dev               # Start dev server
pnpm build             # Production build
pnpm typecheck         # TypeScript strict check
pnpm lint              # ESLint (zero warnings)
pnpm test              # Unit tests
pnpm test:integration  # Integration tests
pnpm test:e2e          # E2E tests (Playwright)
pnpm db:migrate        # Apply migrations
pnpm db:push           # Push schema to dev DB
```
