import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type { BudgetReportPastMonth } from "@/types";

interface PastMonthSpotlightProps {
  pastMonth: BudgetReportPastMonth;
}

export function PastMonthSpotlight({ pastMonth }: PastMonthSpotlightProps) {
  const overPlan = pastMonth.varianceCents > 0;
  const inlineSplit =
    pastMonth.runningCents > 0
      ? `${formatCurrency(pastMonth.billedCents)} billed + ${formatCurrency(pastMonth.runningCents)} API`
      : `${formatCurrency(pastMonth.billedCents)} billed`;

  return (
    <Card>
      <CardHeader>
        <CardDescription className="uppercase tracking-wide text-xs">
          Past month spotlight
        </CardDescription>
        <CardTitle>
          {pastMonth.periodLabel} —{" "}
          <span className="tabular-nums">
            {formatCurrency(pastMonth.actualCents)}
          </span>{" "}
          actual vs{" "}
          <span className="tabular-nums">
            {formatCurrency(pastMonth.plannedCents)}
          </span>{" "}
          planned
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <SpotlightTile
            label="Planned"
            value={formatCurrency(pastMonth.plannedCents)}
            sub="Allocated monthly"
          />
          <SpotlightTile
            label="Actual"
            value={formatCurrency(pastMonth.actualCents)}
            sub={inlineSplit}
            tone={overPlan ? "danger" : "default"}
          />
          <SpotlightTile
            label="Variance"
            value={
              pastMonth.variancePct !== null
                ? `${pastMonth.variancePct >= 0 ? "+" : ""}${pastMonth.variancePct.toFixed(1)}%`
                : "—"
            }
            sub={`${overPlan ? "+" : ""}${formatCurrency(pastMonth.varianceCents)} vs plan`}
            tone={overPlan ? "danger" : "success"}
          />
        </div>

        <PlanVsActualBar pastMonth={pastMonth} />

        {pastMonth.drivers.length > 0 && (
          <DriversSection
            drivers={pastMonth.drivers}
            priorLabel={pastMonth.priorPeriodLabel}
            pastLabel={pastMonth.periodLabel}
          />
        )}
      </CardContent>
    </Card>
  );
}

function SpotlightTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "danger" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "success"
        ? "text-primary"
        : "";
  return (
    <div className="rounded-lg border bg-card/60 p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-mono tabular-nums ${toneClass}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function PlanVsActualBar({ pastMonth }: { pastMonth: BudgetReportPastMonth }) {
  const scale = Math.max(pastMonth.plannedCents, pastMonth.actualCents, 1);
  const plannedWidth = (pastMonth.plannedCents / scale) * 100;
  const billedWidth = (pastMonth.billedCents / scale) * 100;
  const runningWidth = (pastMonth.runningCents / scale) * 100;

  return (
    <div className="space-y-3 rounded-lg border bg-card/40 p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Plan vs actual</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span
              className="inline-block size-2 rounded-sm bg-muted-foreground/40"
              aria-hidden
            />
            Planned
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block size-2 rounded-sm bg-primary"
              aria-hidden
            />
            Billed
          </span>
          {pastMonth.runningCents > 0 && (
            <span className="flex items-center gap-1">
              <span
                className="inline-block size-2 rounded-sm bg-primary/50"
                aria-hidden
              />
              API
            </span>
          )}
        </span>
      </div>
      <div className="space-y-2">
        <Row label="Planned" amount={formatCurrency(pastMonth.plannedCents)}>
          <div
            className="h-5 rounded bg-muted-foreground/30"
            style={{ width: `${plannedWidth}%` }}
          />
        </Row>
        <Row
          label="Actual"
          amount={formatCurrency(pastMonth.actualCents)}
          highlight={pastMonth.varianceCents > 0}
        >
          <div className="flex h-5">
            <div
              className="h-full rounded-l bg-primary"
              style={{ width: `${billedWidth}%` }}
            />
            {pastMonth.runningCents > 0 && (
              <div
                className="h-full bg-primary/50"
                style={{ width: `${runningWidth}%` }}
              />
            )}
          </div>
        </Row>
      </div>
    </div>
  );
}

function Row({
  label,
  amount,
  children,
  highlight = false,
}: {
  label: string;
  amount: string;
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr_auto] items-center gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div>{children}</div>
      <span
        className={`text-sm tabular-nums ${highlight ? "font-medium text-destructive" : ""}`}
      >
        {amount}
      </span>
    </div>
  );
}

function DriversSection({
  drivers,
  priorLabel,
  pastLabel,
}: {
  drivers: BudgetReportPastMonth["drivers"];
  priorLabel: string | null;
  pastLabel: string;
}) {
  return (
    <div>
      <p className="mb-1 text-sm font-medium">Top per-tool changes vs last month</p>
      <p className="mb-3 text-xs text-muted-foreground">
        License-derived spend, {priorLabel ?? "prior period"} → {pastLabel}.
        Invoiced costs without a tool tag aren&apos;t attributed.
      </p>
      <ul className="space-y-2">
        {drivers.map((d, i) => (
          <DriverCard
            key={`${d.toolId ?? "anth"}-${i}`}
            toolName={d.toolName}
            priorCents={d.priorCents}
            pastCents={d.pastCents}
            deltaCents={d.deltaCents}
            deltaPct={d.deltaPct}
          />
        ))}
      </ul>
    </div>
  );
}

function DriverCard({
  toolName,
  priorCents,
  pastCents,
  deltaCents,
  deltaPct,
}: {
  toolName: string;
  priorCents: number;
  pastCents: number;
  deltaCents: number;
  deltaPct: number | null;
}) {
  const positive = deltaCents > 0;
  const tone = positive ? "text-destructive" : "text-primary";

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border bg-card/40 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium" title={toolName}>
          {toolName}
        </p>
        <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
          {formatCurrency(priorCents)} → {formatCurrency(pastCents)}
        </p>
      </div>
      <div className={`whitespace-nowrap text-right tabular-nums ${tone}`}>
        <div className="text-sm font-medium">
          <span aria-hidden className="mr-1">
            {positive ? "↑" : "↓"}
          </span>
          {positive ? "+" : ""}
          {formatCurrency(deltaCents)}
        </div>
        {deltaPct !== null && (
          <div className="text-xs">
            {deltaPct >= 0 ? "+" : ""}
            {deltaPct.toFixed(1)}%
          </div>
        )}
      </div>
    </li>
  );
}
