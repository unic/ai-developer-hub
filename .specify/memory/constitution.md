<!--
  === Sync Impact Report ===
  Version change: N/A (template) → 1.0.0
  Modified principles:
    - [PRINCIPLE_1_NAME] → I. Type-Safe Code Quality
    - [PRINCIPLE_2_NAME] → II. UX Consistency
    - [PRINCIPLE_3_NAME] → III. Performance Budgets
    - [PRINCIPLE_4_NAME] → IV. Accessibility-First
    - [PRINCIPLE_5_NAME] → V. Simplicity & Maintainability
  Added sections:
    - Technology Standards (was [SECTION_2_NAME])
    - Development Workflow (was [SECTION_3_NAME])
    - Governance (filled from [GOVERNANCE_RULES])
  Removed sections: None
  Templates requiring updates:
    - .specify/templates/plan-template.md ✅ no changes needed
      (Constitution Check section is generic)
    - .specify/templates/spec-template.md ✅ no changes needed
      (requirements format already compatible)
    - .specify/templates/tasks-template.md ✅ no changes needed
      (task phases are generic and accommodate principle-driven tasks)
  Follow-up TODOs: None
-->

# AI Developer Hub Constitution

## Core Principles

### I. Type-Safe Code Quality

All production code MUST use TypeScript with strict mode enabled
(`"strict": true` in tsconfig). No use of `any` except where
explicitly justified with a code comment explaining why.

- Every module MUST export well-defined types for its public API.
- Linting (ESLint) and formatting (Prettier) MUST pass with zero
  warnings before code is merged. CI MUST enforce this gate.
- All shared utilities and business logic MUST have unit test
  coverage. Untested code MUST NOT be merged to main.
- Code reviews MUST verify type correctness, naming clarity, and
  adherence to established project patterns.

**Rationale**: Strict typing catches defects at compile time,
reduces runtime errors, and serves as living documentation for
developers working across the codebase.

### II. UX Consistency

Every user-facing surface MUST conform to the project's design
system. Ad-hoc styling and one-off component variants are
prohibited without design-system team approval.

- A shared component library MUST be the single source of truth
  for UI primitives (buttons, inputs, modals, typography, color).
- All interactive elements MUST follow consistent interaction
  patterns: hover states, focus rings, loading indicators, error
  states, and empty states MUST be defined per component.
- Layout spacing, color tokens, and typography scales MUST use
  design tokens—not hardcoded values.
- Visual regression tests SHOULD be maintained for critical UI
  flows to catch unintended changes.

**Rationale**: Inconsistent UI erodes user trust and increases
maintenance cost. A single design system ensures every feature
feels native to the product.

### III. Performance Budgets

Every page and route MUST meet the following Core Web Vitals
targets measured on a mid-tier mobile device over 4G:

- **LCP** (Largest Contentful Paint): < 2.5 seconds
- **INP** (Interaction to Next Paint): < 200 milliseconds
- **CLS** (Cumulative Layout Shift): < 0.1
- **Initial JS bundle** per route: < 150 KB gzipped

Performance MUST be measured in CI via Lighthouse or equivalent.
Regressions that breach these budgets MUST block the merge.

- Images MUST use modern formats (WebP/AVIF) with responsive
  `srcset` and lazy loading for below-the-fold content.
- Third-party scripts MUST be loaded asynchronously and MUST
  NOT block the critical rendering path.
- API calls MUST implement appropriate caching strategies
  (stale-while-revalidate, HTTP cache headers, or client-side
  cache) to minimize redundant network requests.

**Rationale**: Performance directly affects user retention,
conversion, and SEO ranking. Budgets prevent incremental
degradation that compounds over time.

### IV. Accessibility-First

All user-facing features MUST meet WCAG 2.2 Level AA compliance
at minimum. Accessibility MUST be treated as a launch requirement,
not a post-launch enhancement.

- Every interactive element MUST be keyboard navigable with
  visible focus indicators.
- All images and media MUST have meaningful alt text or be
  marked decorative (`alt=""`).
- Color contrast MUST meet AA ratios (4.5:1 normal text,
  3:1 large text). Color MUST NOT be the sole indicator of
  state or meaning.
- ARIA attributes MUST be used correctly—prefer semantic HTML
  elements over ARIA overrides where possible.
- Automated a11y checks (axe-core or equivalent) MUST run in
  CI and block on violations.

**Rationale**: Accessibility is a legal obligation in many
jurisdictions and an ethical commitment. Building it in from
the start is far cheaper than retrofitting.

### V. Simplicity & Maintainability

Every architectural decision MUST favor the simplest solution
that meets current requirements. Speculative abstractions and
premature optimization are prohibited.

- YAGNI: Features and infrastructure MUST NOT be built for
  hypothetical future requirements.
- Dependencies MUST be evaluated for bundle impact, maintenance
  status, and security posture before adoption. Prefer platform
  APIs and small focused libraries over large frameworks.
- Each module MUST have a single clear responsibility. Files
  exceeding 300 lines SHOULD be reviewed for decomposition
  opportunities.
- Code MUST be self-documenting through clear naming. Comments
  MUST explain "why", not "what".

**Rationale**: Complexity is the primary enemy of velocity and
reliability. Simple systems are easier to debug, test, extend,
and onboard new contributors to.

## Technology Standards

The following technology constraints apply to all features:

- **Runtime**: Node.js LTS (current or previous LTS release).
- **Language**: TypeScript with strict mode. No plain JavaScript
  in production code.
- **Frameworks**: Modern React-based stack (Next.js, Remix, or
  equivalent SSR/SSG framework). Framework choice MUST be locked
  per project and documented in the implementation plan.
- **Styling**: CSS Modules, Tailwind CSS, or CSS-in-JS with
  design tokens. Raw CSS files are prohibited in component code.
- **State Management**: Prefer server state libraries
  (TanStack Query, SWR) for async data. Client state MUST use
  the simplest viable approach (React context, Zustand, or
  equivalent).
- **Package Manager**: MUST use a single lockfile-based package
  manager (pnpm preferred). Mixed package managers are prohibited.
- **Security**: All dependencies MUST pass `npm audit` with no
  critical or high vulnerabilities. Environment secrets MUST
  never be committed—use `.env.local` (gitignored) and secure
  secret management in CI/CD.

## Development Workflow

All changes MUST follow this workflow:

1. **Branch**: Create a feature branch from `main`. Branch names
   MUST follow the pattern `<issue-number>-<short-description>`.
2. **Develop**: Write code adhering to all constitution principles.
   Run linting, type checking, and tests locally before pushing.
3. **Pull Request**: Open a PR with a clear description of changes,
   testing performed, and screenshots for UI changes. PRs MUST
   reference the relevant issue or spec.
4. **Review**: At least one approval required before merge. Reviewer
   MUST verify compliance with constitution principles (types,
   performance, accessibility, UX consistency).
5. **CI Gates**: All of the following MUST pass before merge:
   - TypeScript compilation with zero errors
   - ESLint with zero warnings
   - Unit and integration tests passing
   - Lighthouse performance budget check
   - Automated accessibility audit
6. **Merge**: Squash-merge to `main`. Commit message MUST follow
   Conventional Commits format (`feat:`, `fix:`, `docs:`, etc.).

## Governance

This constitution is the authoritative reference for all
development decisions in this project. When a practice conflicts
with this document, the constitution takes precedence.

- **Amendments**: Any change to this constitution MUST be proposed
  via a pull request with rationale. The change MUST be reviewed
  and approved before merge. All affected templates and guidance
  docs MUST be updated in the same PR.
- **Versioning**: This constitution follows semantic versioning:
  - MAJOR: Principle removed, redefined, or governance changed
    incompatibly.
  - MINOR: New principle or section added, or existing guidance
    materially expanded.
  - PATCH: Wording clarification, typo fix, or non-semantic
    refinement.
- **Compliance Review**: Each pull request review MUST include a
  constitution compliance check. Reviewers SHOULD reference
  specific principles when requesting changes.
- **Exceptions**: Temporary exceptions to any principle MUST be
  documented in the PR description with justification, scope,
  and a timeline for resolution.

**Version**: 1.0.0 | **Ratified**: 2026-03-02 | **Last Amended**: 2026-03-02
