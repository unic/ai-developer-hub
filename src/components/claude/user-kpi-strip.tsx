import { KpiStrip, type KpiTile } from "@/components/claude/kpi-strip";
import { formatCurrency } from "@/lib/utils";
import { TrendingDown, TrendingUp, KeyRound, Users } from "lucide-react";
import type { UsersDashboardKpis } from "@/types";

/**
 * 4-tile KPI strip for the Users sub-page:
 *  - Active users this period + MoM count delta
 *  - Top spender (links to that user's row in the table below)
 *  - Top-5 concentration % of org user spend
 *  - Users with no API key (provisioned but unused)
 *
 * Re-uses the `KpiStrip` primitive from spec 026 — no styling re-invention.
 */
export function UserKpiStrip({ kpis }: { kpis: UsersDashboardKpis }) {
  const tiles: KpiTile[] = [
    {
      label: "Active Users",
      value: <span className="tabular-nums">{kpis.activeUsersCurrent}</span>,
      caption: <ActiveUsersDeltaCaption kpis={kpis} />,
      tone:
        kpis.activeUsersDeltaPct === null
          ? "default"
          : kpis.activeUsersDeltaPct >= 0
          ? "success"
          : "danger",
      icon: <Users className="size-3 text-muted-foreground" aria-hidden />,
    },
    {
      label: "Top Spender",
      value: kpis.topSpender ? (
        <a
          href={`#user-${kpis.topSpender.userId}`}
          className="underline-offset-4 hover:underline"
        >
          {formatCurrency(kpis.topSpender.costCents)}
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
      caption: kpis.topSpender ? (
        <span className="truncate">
          {kpis.topSpender.name || kpis.topSpender.email}
          {" · "}
          <span className="tabular-nums">{kpis.topSpender.pctOfOrg}%</span> of
          user spend
        </span>
      ) : (
        "No user spend this period"
      ),
    },
    {
      label: "Top-5 Concentration",
      value: (
        <span className="tabular-nums">
          {kpis.topFiveConcentrationPct == null
            ? "—"
            : `${kpis.topFiveConcentrationPct}%`}
        </span>
      ),
      caption:
        kpis.topFiveConcentrationPct == null
          ? "No spend this period"
          : kpis.topFiveConcentrationPct >= 80
          ? "Top 5 users account for most spend"
          : "Spread across the team",
      tone:
        kpis.topFiveConcentrationPct != null && kpis.topFiveConcentrationPct >= 80
          ? "warn"
          : "default",
    },
    {
      label: "No API Key",
      value: (
        <span>
          <span className="tabular-nums">{kpis.usersWithNoApiKey}</span>
          <span className="text-base font-medium text-muted-foreground">
            {" "}
            / {kpis.usersWithNoApiKeyDenominator}
          </span>
        </span>
      ),
      caption:
        kpis.usersWithNoApiKey === 0
          ? "All active users provisioned"
          : `${kpis.usersWithNoApiKey} active user${kpis.usersWithNoApiKey === 1 ? "" : "s"} not yet linked to a key`,
      tone: kpis.usersWithNoApiKey > 0 ? "warn" : "default",
      icon: <KeyRound className="size-3 text-muted-foreground" aria-hidden />,
    },
  ];

  return <KpiStrip tiles={tiles} />;
}

function ActiveUsersDeltaCaption({ kpis }: { kpis: UsersDashboardKpis }) {
  const pct = kpis.activeUsersDeltaPct;
  if (pct === null) {
    return (
      <span className="text-muted-foreground">
        {kpis.activeUsersPrior === 0
          ? "First month with data"
          : `Prior month ${kpis.activeUsersPrior}`}
      </span>
    );
  }
  if (pct === 0) {
    return (
      <span className="text-muted-foreground">
        Flat vs prior month ({kpis.activeUsersPrior})
      </span>
    );
  }
  if (pct > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-500">
        <TrendingUp className="size-3" /> +{pct}% vs prior month
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-destructive">
      <TrendingDown className="size-3" /> {pct}% vs prior month
    </span>
  );
}
