import type { LucideIcon } from "lucide-react";
import { ArrowLeftRight, LineChart } from "lucide-react";

/**
 * Catalogue of scenario calculators. Single source of truth for the index
 * cards and (later) the section tab strip. Add a calculator by appending an
 * entry here and creating its route under `src/app/scenarios/<slug>/`.
 */
export type ScenarioStatus = "live" | "soon";

export type ScenarioMeta = {
  slug: string;
  title: string;
  blurb: string;
  icon: LucideIcon;
  status: ScenarioStatus;
};

export const SCENARIOS: ScenarioMeta[] = [
  {
    slug: "api-subscription",
    title: "API → Subscription Migration",
    blurb:
      "Map metered Anthropic API users onto flat Standard / Premium seats and model the bill under four scenarios.",
    icon: ArrowLeftRight,
    status: "live",
  },
  {
    slug: "budget-forecast",
    title: "Budget / Cost Forecast Simulation",
    blurb:
      "Project spend forward from historical run-rate and simulate budget outcomes across the fiscal year.",
    icon: LineChart,
    status: "live",
  },
];

export function getScenario(slug: string): ScenarioMeta | undefined {
  return SCENARIOS.find((s) => s.slug === slug);
}
