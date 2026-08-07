-- 043-mcp-write-tools
--
-- Hand-edited after drizzle-kit generate. Two corrections to the generated SQL:
--
-- 1. `ADD COLUMN source varchar(20) NOT NULL` with no default cannot be applied
--    to a table that already has rows. Added nullable -> backfilled -> SET NOT
--    NULL, which reaches NOT NULL without that restriction. This
--    migration leaves the column without a default; 0031
--    (0031_change_history_source_default.sql) adds `DEFAULT 'ui'` afterwards,
--    solely for deploy safety — see that file's header for why. Provenance
--    itself is enforced at the type level, not by the database: `source` is a
--    required field on `HistoryOptions` (src/lib/history.ts), so the compiler
--    forces every call site through those helpers to state it explicitly.
--
-- 2. `CREATE UNIQUE INDEX license_assignments_one_active_idx` aborts if the table
--    already violates the invariant. Nothing enforced it before, so duplicates
--    are possible; they are data corruption (one seat counted twice in every
--    aggregation that sums cost_at_assignment_cents). Remediated deterministically
--    below — see the comment on the survivor rule, which was corrected after
--    checking real data — with a NOTICE naming the count so it is visible in the
--    migration output rather than silent.

ALTER TABLE "change_history" ADD COLUMN "source" varchar(20);--> statement-breakpoint

UPDATE "change_history" SET "source" = 'ui' WHERE "source" IS NULL;--> statement-breakpoint

ALTER TABLE "change_history" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint

CREATE INDEX "change_history_source_idx" ON "change_history" USING btree ("source");--> statement-breakpoint

DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count
  FROM (
    SELECT "user_id", "tool_id"
    FROM "license_assignments"
    WHERE "status" = 'active'
    GROUP BY "user_id", "tool_id"
    HAVING count(*) > 1
  ) d;

  IF dup_count > 0 THEN
    RAISE NOTICE '043: found % (user, tool) pair(s) with multiple ACTIVE assignments; keeping the earliest-assigned row in each and zero-duration-revoking the rest.', dup_count;

    -- Survivor = earliest assigned_at (tie-break lowest id), NOT highest id.
    -- Verified against real data: id 391 carries an EARLIER assigned_at than id
    -- 102 for the same (user, tool), because the license-request workflow can
    -- insert a backdated row later. So "highest id == most recent" is false here,
    -- and picking by id would silently move the seat's start date forward.
    -- Keeping the earliest preserves the true, continuous holding period.
    --
    -- revoked_at = assigned_at (a zero-duration row), NOT now(): point-in-time
    -- reporting selects `assigned_at <= asOf AND (revoked_at IS NULL OR
    -- revoked_at > asOf)` (getAssignmentSnapshotAt in src/actions/assignments.ts).
    -- With now(), the spurious row still satisfies `revoked_at > asOf` for every
    -- PAST date, so the double-count would survive its own remediation in every
    -- historical report. Collapsing the row to zero duration makes it count at no
    -- asOf at all, which is the honest representation: it never existed.
    UPDATE "license_assignments"
    SET "status" = 'inactive',
        "revoked_at" = "assigned_at",
        "updated_at" = now()
    WHERE "id" IN (
      SELECT "id"
      FROM (
        SELECT "id",
               row_number() OVER (
                 PARTITION BY "user_id", "tool_id"
                 ORDER BY "assigned_at" ASC, "id" ASC
               ) AS rn
        FROM "license_assignments"
        WHERE "status" = 'active'
      ) ranked
      WHERE ranked.rn > 1
    );
  END IF;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX "license_assignments_one_active_idx" ON "license_assignments" USING btree ("user_id","tool_id") WHERE "license_assignments"."status" = 'active';
