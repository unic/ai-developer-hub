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
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>
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
  // Shared scale across all rows: max(prior, past) over every driver so the
  // x-axis position carries absolute meaning, not row-relative magnitude.
  const scale = Math.max(
    1,
    ...drivers.flatMap((d) => [d.priorCents, d.pastCents])
  );

  return (
    <div>
      <p className="mb-1 text-sm font-medium">Top per-tool changes vs last month</p>
      <p className="mb-3 text-xs text-muted-foreground">
        License-derived spend, {priorLabel ?? "prior period"} → {pastLabel}.
        Invoiced costs without a tool tag aren&apos;t attributed.
      </p>
      <ul className="space-y-3">
        {drivers.map((d, i) => (
          <SlopeRow
            key={`${d.toolId ?? "anth"}-${i}`}
            toolName={d.toolName}
            priorCents={d.priorCents}
            pastCents={d.pastCents}
            deltaCents={d.deltaCents}
            deltaPct={d.deltaPct}
            scale={scale}
          />
        ))}
      </ul>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(110px,auto)] items-center gap-3 text-[10px] text-muted-foreground">
        <span />
        <div className="flex justify-between">
          <span>$0</span>
          <span>{formatCurrency(scale)}</span>
        </div>
        <div className="flex items-center gap-3 justify-self-end">
          <span className="flex items-center gap-1">
            <span
              className="inline-block size-2 rounded-full border border-muted-foreground bg-background"
              aria-hidden
            />
            {priorLabel ?? "prior"}
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block size-2 rounded-full bg-foreground"
              aria-hidden
            />
            {pastLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

function SlopeRow({
  toolName,
  priorCents,
  pastCents,
  deltaCents,
  deltaPct,
  scale,
}: {
  toolName: string;
  priorCents: number;
  pastCents: number;
  deltaCents: number;
  deltaPct: number | null;
  scale: number;
}) {
  const positive = deltaCents > 0;
  const priorPct = (priorCents / scale) * 100;
  const pastPct = (pastCents / scale) * 100;
  const lineLeft = Math.min(priorPct, pastPct);
  const lineWidth = Math.abs(pastPct - priorPct);

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(110px,auto)] items-center gap-3">
      <span className="truncate text-sm" title={toolName}>
        {toolName}
      </span>
      <div className="relative h-5">
        <div
          className={`absolute top-1/2 h-0.5 -translate-y-1/2 ${
            positive ? "bg-destructive/60" : "bg-primary/60"
          }`}
          style={{ left: `${lineLeft}%`, width: `${lineWidth}%` }}
          aria-hidden
        />
        <div
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-muted-foreground bg-background"
          style={{ left: `${priorPct}%` }}
          title={`Prior: ${formatCurrency(priorCents)}`}
          aria-label={`Prior ${formatCurrency(priorCents)}`}
        />
        <div
          className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
            positive ? "bg-destructive" : "bg-primary"
          }`}
          style={{ left: `${pastPct}%` }}
          title={`Past: ${formatCurrency(pastCents)}`}
          aria-label={`Past ${formatCurrency(pastCents)}`}
        />
      </div>
      <span
        className={`whitespace-nowrap text-sm tabular-nums ${
          positive ? "text-destructive" : "text-primary"
        }`}
      >
        {positive ? "+" : ""}
        {formatCurrency(deltaCents)}
        {deltaPct !== null && (
          <span className="ml-2 text-xs text-muted-foreground">
            {deltaPct >= 0 ? "+" : ""}
            {deltaPct.toFixed(1)}%
          </span>
        )}
      </span>
    </li>
  );
}
