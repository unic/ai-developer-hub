-- Custom SQL migration file, put your code below! --

-- One-time backfill: active assignments whose cost snapshot drifted from
-- their tier's current price (tier prices were edited without propagation
-- before fix/tier-cost-propagation). Revoked/inactive assignments keep
-- their historical snapshot on purpose.
UPDATE "license_assignments" la
SET "cost_at_assignment_cents" = t."monthly_cost_cents",
    "updated_at" = now()
FROM "access_tiers" t
WHERE la."tier_id" = t."id"
  AND la."status" = 'active'
  AND la."cost_at_assignment_cents" <> t."monthly_cost_cents";
