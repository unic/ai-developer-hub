import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { loadBudgetForecastDataset } from "@/actions/scenarios";
import { listForecastScenarios } from "@/actions/forecast-scenarios";
import { BudgetForecastClient } from "./budget-forecast-client";

export const metadata: Metadata = {
  title: "Budget / Cost Forecast · Scenarios",
};

export default async function BudgetForecastScenarioPage() {
  const [dataset, savedScenarios] = await Promise.all([
    loadBudgetForecastDataset(),
    listForecastScenarios(),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <Link
          href="/scenarios"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> Scenarios
        </Link>
        <div>
          <h1 className="text-2xl font-medium tracking-tight text-ink">
            Budget / Cost Forecast Simulation
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Anchor on actual spend to date, then project the rest of the fiscal
            year forward under per-tool growth assumptions — and see where the
            portfolio lands against the budget.
          </p>
        </div>
      </header>

      {dataset.periods.length === 0 ? (
        <EmptyState />
      ) : (
        <BudgetForecastClient
          dataset={dataset}
          savedScenarios={savedScenarios}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-[14px] border border-border bg-card p-10 text-center">
      <p className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">
        [ NO ACTIVE BUDGET ]
      </p>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
        No active fiscal-year budget was found. Create and activate a budget to
        project spend forward against it.
      </p>
    </div>
  );
}
