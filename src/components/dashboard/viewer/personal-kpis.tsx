import { KpiWithMom } from "@/components/reports/overview/kpi-with-mom";
import { formatCurrency } from "@/lib/utils";
import type { CostData } from "@/types";
import type { ViewerModelTotal } from "@/actions/dashboard";

interface PersonalKpisProps {
  cost: CostData;
  modelTotals: ViewerModelTotal[];
  totalInputTokens: number;
  totalOutputTokens: number;
  toolCount: number;
  toolNames: string[];
  hasApiKey: boolean;
}

export function PersonalKpis({
  cost,
  modelTotals,
  totalInputTokens,
  totalOutputTokens,
  toolCount,
  toolNames,
  hasApiKey,
}: PersonalKpisProps) {
  const todayCents =
    cost.available && cost.dailyBreakdown && cost.dailyBreakdown.length > 0
      ? (cost.dailyBreakdown.at(-1)?.totalCents ?? 0)
      : 0;
  const totalTokens = totalInputTokens + totalOutputTokens;
  const formatTokens = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(2)}M`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(1)}k`
        : n.toString();

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiWithMom
        label="Spend this month"
        value={hasApiKey ? formatCurrency(cost.monthlyTotalCents) : "—"}
        comparison={
          hasApiKey
            ? `${modelTotals.length} model${modelTotals.length === 1 ? "" : "s"} used`
            : "No Claude API key configured"
        }
      />
      <KpiWithMom
        label="Tokens this month"
        value={hasApiKey ? formatTokens(totalTokens) : "—"}
        comparison={
          hasApiKey
            ? `${formatTokens(totalInputTokens)} in · ${formatTokens(totalOutputTokens)} out`
            : "Tracked once API key is configured"
        }
      />
      <KpiWithMom
        label="My tools"
        value={toolCount.toLocaleString()}
        comparison={
          toolNames.length > 0
            ? toolNames.slice(0, 3).join(" · ") + (toolNames.length > 3 ? " · …" : "")
            : "No active assignments"
        }
      />
      <KpiWithMom
        label="Today"
        value={hasApiKey ? formatCurrency(todayCents) : "—"}
        comparison={
          hasApiKey
            ? cost.latestDataDate
              ? `Latest data ${cost.latestDataDate}`
              : "Awaiting data"
            : "—"
        }
      />
    </div>
  );
}
