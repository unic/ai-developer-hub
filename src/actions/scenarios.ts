"use server";

import { unstable_cache } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { getApiSubscriptionDataset } from "@/lib/scenarios/queries";
import { getBudgetForecastDataset } from "@/lib/scenarios/budget-forecast-queries";
import type { ForecastDataset } from "@/lib/scenarios/budget-forecast";
import type { ApiSubscriptionDataset } from "@/lib/scenarios/types";

// Cached behind the same revalidation cadence as the Anthropic usage data.
// Tag: revalidate with `revalidateTag("scenarios:api-subscription")` from the
// Anthropic usage sync when fresher numbers are needed sooner than the TTL.
const loadCached = unstable_cache(
  () => getApiSubscriptionDataset(),
  ["scenarios:api-subscription:v1"],
  { tags: ["scenarios:api-subscription"], revalidate: 3600 },
);

export async function loadApiSubscriptionDataset(): Promise<ApiSubscriptionDataset> {
  const admin = await requireAdmin();
  if (!admin) throw new Error("Unauthorized");
  return loadCached();
}

// The forecast draws on both the budget data and the Anthropic usage that feeds
// the metered API line, so it shares the api-subscription revalidation tag in
// addition to its own.
const loadForecastCached = unstable_cache(
  () => getBudgetForecastDataset(),
  ["scenarios:budget-forecast:v1"],
  {
    tags: ["scenarios:budget-forecast", "scenarios:api-subscription"],
    revalidate: 3600,
  },
);

export async function loadBudgetForecastDataset(): Promise<ForecastDataset> {
  const admin = await requireAdmin();
  if (!admin) throw new Error("Unauthorized");
  return loadForecastCached();
}
