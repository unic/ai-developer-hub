import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { SCENARIOS, type ScenarioMeta } from "@/lib/scenarios/registry";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Scenarios" };

export default function ScenariosPage() {
  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Cost modelling
        </p>
        <h1 className="text-2xl font-medium tracking-tight text-ink">
          Scenarios
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          What-if calculators for AI tooling spend. Model a change against live
          data before you commit to it.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {SCENARIOS.map((scenario) => (
          <ScenarioCard key={scenario.slug} scenario={scenario} />
        ))}
      </div>
    </div>
  );
}

function ScenarioCard({ scenario }: { scenario: ScenarioMeta }) {
  const { icon: Icon, title, blurb, status, slug } = scenario;
  const live = status === "live";

  const card = (
    <Card
      className={cn(
        "group h-full transition-colors",
        live ? "hover:border-ink" : "opacity-55",
      )}
    >
      <CardContent className="flex h-full flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <Icon className="size-5 text-ink" strokeWidth={1.5} aria-hidden />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {live ? "Live" : "Soon"}
          </span>
        </div>
        <h2 className="text-base font-medium text-ink">{title}</h2>
        <p className="text-sm text-muted-foreground">{blurb}</p>
        {live ? (
          <span className="mt-auto inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink">
            Open
            <ArrowRight
              className="size-3.5 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </span>
        ) : (
          <span className="mt-auto font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
            In planning
          </span>
        )}
      </CardContent>
    </Card>
  );

  if (!live) return card;

  return (
    <Link
      href={`/scenarios/${slug}`}
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {card}
    </Link>
  );
}
