# Data Model: Retro-Glitch Theme System

**Feature Branch**: `002-retro-glitch-themes`
**Date**: 2026-03-03

## Entities

### UserPreferences (embedded in `users` table)

A JSONB column on the existing `users` table storing appearance preferences.

| Field | Type | Default | Description |
| ----- | ---- | ------- | ----------- |
| `theme` | `"light" \| "dark" \| "system"` | `"system"` | Color scheme preference. `"system"` follows OS setting. |
| `leanMode` | `boolean` | `false` | Whether lean mode (no retro-glitch effects) is active. |

**Constraints**:
- `theme` must be one of the three enumerated values
- `leanMode` must be a boolean
- Default value applied at column level: `'{"theme":"system","leanMode":false}'`

**Schema change** (Drizzle ORM):
```
ALTER TABLE "users" ADD COLUMN "preferences" jsonb DEFAULT '{"theme":"system","leanMode":false}';
```

**TypeScript type**:
```typescript
export type UserPreferences = {
  theme: "light" | "dark" | "system";
  leanMode: boolean;
};
```

### Design Token Set (CSS-only, no DB)

Four design token combinations are defined entirely in CSS custom properties. No database entity — these are compile-time artifacts in `globals.css`.

| Combination | Theme Class | Retro Attribute | `--retro` Value |
| ----------- | ----------- | --------------- | --------------- |
| Dark + Full Retro | `.dark` | `data-retro` | `1` |
| Dark + Lean | `.dark` | (absent) | `0` |
| Light + Full Retro | (none) | `data-retro` | `1` |
| Light + Lean | (none) | (absent) | `0` |

**State transitions**:
- Theme toggle: `next-themes` adds/removes `.dark` class on `<html>`
- Lean mode toggle: JavaScript adds/removes `data-retro` attribute on `<html>`
- Both are independent and can be toggled without affecting the other

## Relationships

```
users (existing)
  └── preferences: jsonb  ← NEW COLUMN
        ├── theme: "light" | "dark" | "system"
        └── leanMode: boolean

<html> element (runtime state)
  ├── class="dark"          ← managed by next-themes
  └── data-retro            ← managed by LeanModeProvider
        └── --retro: 0 | 1  ← CSS custom property derived from data-retro presence
```

## Validation Rules

| Rule | Enforcement | Location |
| ---- | ----------- | -------- |
| `theme` is `"light"`, `"dark"`, or `"system"` | Zod `z.enum()` | `src/lib/validators.ts` (shared), `src/actions/preferences.ts` (server) |
| `leanMode` is boolean | Zod `z.boolean()` | `src/lib/validators.ts` (shared), `src/actions/preferences.ts` (server) |
| Preferences JSONB is valid | Zod parse on read from DB | `src/actions/preferences.ts` |
| Invalid stored preference falls back to default | Application-level fallback | `src/contexts/lean-mode-context.tsx`, theme provider config |

## Migration Notes

- **Non-breaking**: Adding a nullable JSONB column with a default does not affect existing rows
- **Backfill**: Not needed — `DEFAULT` clause populates for existing rows on first read via `COALESCE`
- **Rollback**: `ALTER TABLE "users" DROP COLUMN "preferences"` — no data dependencies
