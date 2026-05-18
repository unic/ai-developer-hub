import { Card, CardContent } from "@/components/ui/card";
import { cn, formatCurrency } from "@/lib/utils";
import { AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";

export type KpiTile = {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  tone?: "default" | "warn" | "danger" | "success";
  ring?: boolean;
  icon?: ReactNode;
};

type KpiStripProps = {
  tiles: KpiTile[];
};

export function KpiStrip({ tiles }: KpiStripProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile, idx) => (
        <KpiTileCard key={idx} tile={tile} />
      ))}
    </div>
  );
}

function KpiTileCard({ tile }: { tile: KpiTile }) {
  const captionId = `kpi-caption-${tile.label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <Card
      className={cn(
        "relative overflow-hidden",
        tile.ring && tile.tone === "danger" && "ring-2 ring-destructive/60"
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {tile.label}
          </p>
          {tile.icon}
        </div>
        <p
          className="mt-2 text-2xl font-bold tabular-nums tracking-tight"
          aria-describedby={captionId}
        >
          {tile.value}
        </p>
        {tile.caption !== undefined && (
          <p
            id={captionId}
            className={cn(
              "mt-1 text-xs",
              tile.tone === "danger"
                ? "text-destructive"
                : tile.tone === "warn"
                ? "text-amber-500"
                : tile.tone === "success"
                ? "text-emerald-500"
                : "text-muted-foreground"
            )}
          >
            {tile.caption}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Helper builder for the org-level KPI strip on `/claude`.
 */
export function buildOrgKpiTiles(args: {
  month: string;
  totalCents: number;
  momDeltaCents: number;
  momDeltaPct: number | null;
  priorMonthCents: number;
  projectedMonthEndCents: number;
  orgBudgetCents: number | null;
  workspacesOverEightyCount: number;
  workspacesWithLimitCount: number;
  topOverWorkspaceName: string | null;
  topOverWorkspaceUtilizationPct: number | null;
}): KpiTile[] {
  const {
    month,
    totalCents,
    momDeltaCents,
    momDeltaPct,
    priorMonthCents,
    projectedMonthEndCents,
    orgBudgetCents,
    workspacesOverEightyCount,
    workspacesWithLimitCount,
    topOverWorkspaceName,
    topOverWorkspaceUtilizationPct,
  } = args;

  const [year, monthNum] = month.split("-");
  const monthLabel = new Date(Number(year), Number(monthNum) - 1, 1).toLocaleString(
    "en-US",
    { month: "short", year: "numeric" }
  );

  const momCaption =
    momDeltaPct === null ? (
      <span className="text-muted-foreground">— no spend last month</span>
    ) : momDeltaPct >= 0 ? (
      <span className="inline-flex items-center gap-1 text-emerald-500">
        <TrendingUp className="size-3" /> +{momDeltaPct}% vs prior month
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-destructive">
        <TrendingDown className="size-3" /> {momDeltaPct}% vs prior month
      </span>
    );

  const isOverBudget =
    orgBudgetCents != null && projectedMonthEndCents > orgBudgetCents;
  const projectedPct =
    orgBudgetCents != null && orgBudgetCents > 0
      ? Math.round((projectedMonthEndCents / orgBudgetCents) * 100)
      : null;

  const tiles: KpiTile[] = [
    {
      label: `Total · ${monthLabel}`,
      value: formatCurrency(totalCents),
      caption:
        priorMonthCents > 0
          ? `Prior month ${formatCurrency(priorMonthCents)}`
          : "First month with data",
    },
    {
      label: "MoM Delta",
      value:
        momDeltaCents >= 0
          ? `+${formatCurrency(momDeltaCents)}`
          : `-${formatCurrency(Math.abs(momDeltaCents))}`,
      caption: momCaption,
      tone: momDeltaPct === null ? "default" : momDeltaPct >= 0 ? "success" : "danger",
    },
    {
      label: "Projected Month-End",
      value: formatCurrency(projectedMonthEndCents),
      caption:
        orgBudgetCents == null
          ? "No org budget set"
          : isOverBudget
          ? `${projectedPct}% of ${formatCurrency(orgBudgetCents)} budget`
          : `${projectedPct ?? 0}% of ${formatCurrency(orgBudgetCents)} budget`,
      tone: isOverBudget ? "danger" : projectedPct != null && projectedPct >= 80 ? "warn" : "default",
      ring: isOverBudget,
      icon: isOverBudget ? <AlertTriangle className="size-3 text-destructive" /> : undefined,
    },
    {
      label: "Workspaces Over 80%",
      value: (
        <span>
          {workspacesOverEightyCount}
          <span className="text-base font-medium text-muted-foreground">
            {" "}
            / {workspacesWithLimitCount}
          </span>
        </span>
      ),
      caption:
        workspacesOverEightyCount === 0
          ? "All within limits"
          : topOverWorkspaceName && topOverWorkspaceUtilizationPct != null
          ? `${topOverWorkspaceName} · ${topOverWorkspaceUtilizationPct}%`
          : null,
      tone: workspacesOverEightyCount > 0 ? "warn" : "default",
    },
  ];
  return tiles;
}
