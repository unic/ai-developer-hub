import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { loadApiSubscriptionDataset } from "@/actions/scenarios";
import { ApiSubscriptionClient } from "./api-subscription-client";

export const metadata: Metadata = { title: "API → Subscription · Scenarios" };

export default async function ApiSubscriptionScenarioPage() {
  const dataset = await loadApiSubscriptionDataset();

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
            API → Subscription Migration
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Every Claude Console (Anthropic API) key is a metered, pay-as-you-go
            consumer. Map each onto a flat Standard or Premium seat and compare
            the bill against today&apos;s spend.
          </p>
        </div>
      </header>

      {dataset.users.length === 0 ? (
        <EmptyState />
      ) : (
        <ApiSubscriptionClient dataset={dataset} />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-[14px] border border-border bg-card p-10 text-center">
      <p className="font-mono text-sm uppercase tracking-[0.16em] text-muted-foreground">
        [ NO API USERS ]
      </p>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
        No Claude Console license keys were found. Assign API keys to users and
        run an Anthropic usage sync to populate this model.
      </p>
    </div>
  );
}
