-- Fix budget period end dates: change exclusive first-of-next-period to
-- inclusive last-day-of-period so date range queries using <= don't overlap.
--
-- Monthly periods had end_date = first of next month (e.g. Jan ended 02-01).
-- Quarterly periods had end_date = first of next quarter (e.g. Q1 ended 04-01).
-- This caused costs on boundary dates to appear in two adjacent periods.

UPDATE budget_periods
SET end_date = (end_date::date - INTERVAL '1 day')::date
WHERE end_date::text LIKE '%-01'
  AND start_date::text LIKE '%-01'
  AND end_date::date > start_date::date;
