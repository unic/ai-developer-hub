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

        {pastMonth.drivers.length > 0 && <DriversSection drivers={pastMonth.drivers} />}
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
}: {
  drivers: BudgetReportPastMonth["drivers"];
}) {
  const maxAbs = Math.max(...drivers.map((d) => Math.abs(d.deltaCents)));
  return (
    <div>
      <p className="mb-2 text-sm font-medium">Top variance drivers</p>
      <p className="mb-3 text-xs text-muted-foreground">
        MoM diff vs prior period (license-derived). Invoiced costs without a
        tool tag aren&apos;t attributed.
      </p>
      <ul className="space-y-2">
        {drivers.map((d, i) => (
          <DriverRow
            key={`${d.toolId ?? "anth"}-${i}`}
            rank={i + 1}
            toolName={d.toolName}
            deltaCents={d.deltaCents}
            deltaPct={d.deltaPct}
            maxAbs={maxAbs}
          />
        ))}
      </ul>
    </div>
  );
}

function DriverRow({
  rank,
  toolName,
  deltaCents,
  deltaPct,
  maxAbs,
}: {
  rank: number;
  toolName: string;
  deltaCents: number;
  deltaPct: number | null;
  maxAbs: number;
}) {
  const positive = deltaCents > 0;
  const widthPct = maxAbs > 0 ? (Math.abs(deltaCents) / maxAbs) * 100 : 0;
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-3">
      <span className="text-xs text-muted-foreground tabular-nums">{rank}</span>
      <span className="truncate text-sm">{toolName}</span>
      <div
        className={`h-4 rounded ${positive ? "bg-destructive/20" : "bg-primary/20"}`}
      >
        <div
          className={`h-full rounded ${positive ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span
        className={`text-sm tabular-nums ${positive ? "text-destructive" : "text-primary"}`}
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
