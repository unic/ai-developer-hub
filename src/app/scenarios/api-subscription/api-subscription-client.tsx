"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, RotateCcw } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { SegmentedBar } from "@/components/ui/segmented-bar";
import { cn, formatCurrency } from "@/lib/utils";
import { formatUSD0 } from "@/lib/chart-format";
import {
  computeScenarios,
  type Population,
  type ScenarioInputs,
  type ScenarioRow,
  type SeatTier,
  type UsageBasis,
} from "@/lib/scenarios/api-subscription";
import type { ApiSubscriptionDataset } from "@/lib/scenarios/types";

// Headline/aggregate figures use whole-dollar formatUSD0; per-user cells keep
// 2-decimal precision via formatCurrency.

function monthLabel(ym: string, withYear: boolean): string {
  const [y, m] = ym.split("-").map(Number);
  const mon = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  return withYear ? `${mon} '${String(y).slice(2)}` : mon;
}

function toBasis(key: string): UsageBasis {
  if (key.startsWith("month:")) return { month: key.slice(6) };
  return key as Exclude<UsageBasis, object>;
}

function basisLabel(key: string, ds: ApiSubscriptionDataset): string {
  if (key.startsWith("month:")) return monthLabel(key.slice(6), true);
  if (key === "latestComplete") return "latest complete month";
  if (key === "peakComplete") return "peak complete month";
  return `avg of ${ds.completeMonths.length} complete months`;
}

/** Oxford-comma join: ["a"]→"a"; ["a","b"]→"a and b"; ["a","b","c"]→"a, b, and c". */
function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

type SortKey = "name" | "status" | "usage" | "tier" | "seat" | "delta";

// Seat-tier presentation kept in one place so the three-tier model stays
// first-class: sort rank (tier escalation API → Standard → Premium, not a cost
// ordering — see mapSeat) and per-tier pill styling.
const TIER_SORT_ORDER: Record<SeatTier, number> = {
  api: 0,
  standard: 1,
  premium: 2,
};

const SEAT_PILL: Record<SeatTier, { className: string; label: string }> = {
  api: {
    className: "border border-dashed border-input text-faint",
    label: "API",
  },
  standard: {
    className: "border border-input text-muted-foreground",
    label: "standard",
  },
  premium: { className: "border border-ink text-ink", label: "premium" },
};

export function ApiSubscriptionClient({
  dataset,
}: {
  dataset: ApiSubscriptionDataset;
}) {
  const [standardDollars, setStandardDollars] = useState(
    dataset.defaultStandardCents / 100,
  );
  const [premiumDollars, setPremiumDollars] = useState(
    dataset.defaultPremiumCents / 100,
  );
  const [thresholdDollars, setThresholdDollars] = useState(
    Math.round(dataset.defaultPremiumCents / 100),
  );
  const [apiThresholdDollars, setApiThresholdDollars] = useState(
    Math.round(dataset.defaultStandardCents / 100),
  );
  const [basisKey, setBasisKey] = useState("avgComplete");
  const [population, setPopulation] = useState<Population>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "usage",
    dir: -1,
  });

  const inputs: ScenarioInputs = useMemo(
    () => ({
      standardCents: Math.max(0, Math.round(standardDollars * 100)),
      premiumCents: Math.max(0, Math.round(premiumDollars * 100)),
      premiumThresholdCents: Math.max(0, Math.round(thresholdDollars * 100)),
      apiThresholdCents: Math.max(0, Math.round(apiThresholdDollars * 100)),
      basis: toBasis(basisKey),
      population,
    }),
    [
      standardDollars,
      premiumDollars,
      thresholdDollars,
      apiThresholdDollars,
      basisKey,
      population,
    ],
  );

  const result = useMemo(
    () => computeScenarios(dataset, inputs),
    [dataset, inputs],
  );

  const activeCount = useMemo(
    () => dataset.users.filter((u) => u.status === "active").length,
    [dataset.users],
  );

  const displayMonths = useMemo(
    () => [...dataset.completeMonths, ...dataset.partialMonths].sort(),
    [dataset.completeMonths, dataset.partialMonths],
  );
  const partialSet = useMemo(
    () => new Set(dataset.partialMonths),
    [dataset.partialMonths],
  );
  const spanMultiYear = useMemo(
    () => new Set(displayMonths.map((m) => m.slice(0, 4))).size > 1,
    [displayMonths],
  );
  // The most recent month is the current (month-to-date) one; an earlier partial
  // month is partial because data collection started mid-month, not because it's MTD.
  const latestMonth = displayMonths[displayMonths.length - 1];

  // Per-month column totals for the table footer, in a single pass over the
  // population (avoids re-scanning all rows once per column on every render).
  const monthColumnSums = useMemo(() => {
    const sums: Record<string, number> = {};
    for (const row of result.rows) {
      for (const m of displayMonths) {
        sums[m] = (sums[m] ?? 0) + (row.user.monthly[m] ?? 0);
      }
    }
    return sums;
  }, [result.rows, displayMonths]);

  const sortedRows = useMemo(() => {
    const { key, dir } = sort;
    const val = (r: ScenarioRow): string | number => {
      switch (key) {
        case "name":
          return r.user.name.toLowerCase();
        case "status":
          return r.user.status;
        case "tier":
          return TIER_SORT_ORDER[r.tier];
        case "seat":
          return r.seatCents;
        case "delta":
          return r.deltaCents;
        default:
          return r.usageCents;
      }
    };
    return [...result.rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x < y) return -1 * dir;
      if (x > y) return 1 * dir;
      return 0;
    });
  }, [result.rows, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 1 ? -1 : 1 }
        : { key, dir: key === "name" || key === "status" ? 1 : -1 },
    );
  }

  // The API floor can never sit above the Premium ceiling. Lowering Premium drags
  // the floor down with it; raising the floor stops at the current Premium value.
  function onApiThreshold(value: number) {
    setApiThresholdDollars(Math.min(value, thresholdDollars));
  }
  function onPremiumThreshold(value: number) {
    setThresholdDollars(value);
    setApiThresholdDollars((prev) => Math.min(prev, value));
  }

  function reset() {
    setStandardDollars(dataset.defaultStandardCents / 100);
    setPremiumDollars(dataset.defaultPremiumCents / 100);
    setThresholdDollars(Math.round(dataset.defaultPremiumCents / 100));
    setApiThresholdDollars(Math.round(dataset.defaultStandardCents / 100));
    setBasisKey("avgComplete");
    setPopulation("all");
  }

  const saving = result.baselineCents - result.rightSizedCents; // + = saving
  const savingState: "saves" | "costs" | "flat" =
    saving > 0 ? "saves" : saving < 0 ? "costs" : "flat";
  // Percentage is undefined when there's no baseline spend to compare against.
  const savingPct =
    result.baselineCents > 0
      ? Math.round((Math.abs(saving) / result.baselineCents) * 100)
      : null;
  const savingSign =
    savingState === "saves" ? "−" : savingState === "costs" ? "+" : "";
  const verdictPhrase =
    savingState === "flat"
      ? "the same as"
      : savingState === "saves"
        ? savingPct !== null
          ? `a ${savingPct}% cut from`
          : "less than"
        : savingPct !== null
          ? `${savingPct}% above`
          : "more than";
  // Tone classes per state — flat (equal cost) reads neutral, not negative.
  const verdictBorder =
    savingState === "saves"
      ? "border-ink"
      : savingState === "costs"
        ? "border-destructive"
        : "border-border";
  const verdictText =
    savingState === "saves"
      ? "text-ink"
      : savingState === "costs"
        ? "text-destructive"
        : "text-muted-foreground";
  const deltaText =
    savingState === "saves"
      ? "text-success"
      : savingState === "costs"
        ? "text-destructive"
        : "text-faint";

  // The right-sized population as a partition, omitting empty groups, so the
  // verdict reads correctly for any mix (including when Standard or API is empty).
  const seatBreakdown = joinParts(
    [
      result.premiumCount > 0 ? `${result.premiumCount} Premium` : null,
      result.standardCount > 0 ? `${result.standardCount} Standard` : null,
      result.apiCount > 0 ? `${result.apiCount} kept on metered API` : null,
    ].filter((part): part is string => part !== null),
  );
  // Drop the breakdown interjection when there's nothing to list (e.g.
  // population=active with no active keys) so the copy never shows dangling
  // dashes ("— —").
  const verdictLead =
    `Right-sizing the ${result.count} API ${
      result.count === 1 ? "user" : "users"
    }` + (seatBreakdown ? ` — ${seatBreakdown} —` : "");

  // Single source for the four scenarios — drives both the cards and the bars.
  const scenarios = [
    {
      tag: "Today",
      title: "Metered API",
      barLabel: "Metered API",
      barSub: "today",
      cents: result.baselineCents,
      mix: `${result.count} pay-as-you-go keys`,
      isBaseline: true,
    },
    {
      tag: "Flat",
      title: "All → Standard",
      barLabel: "All Standard",
      barSub: `${result.count} seats`,
      cents: result.allStandardCents,
      mix: `${result.count} × ${formatUSD0(inputs.standardCents)}`,
      isBaseline: false,
    },
    {
      tag: "Flat",
      title: "All → Premium",
      barLabel: "All Premium",
      barSub: `${result.count} seats`,
      cents: result.allPremiumCents,
      mix: `${result.count} × ${formatUSD0(inputs.premiumCents)}`,
      isBaseline: false,
    },
    {
      tag: "Right-sized",
      title: "Threshold mix",
      barLabel: "Right-sized",
      barSub: `${result.apiCount}A · ${result.standardCount}S · ${result.premiumCount}P`,
      cents: result.rightSizedCents,
      mix: `${result.premiumCount} Premium · ${result.standardCount} Standard · ${result.apiCount} metered API`,
      isBaseline: false,
    },
  ];
  const maxBar = Math.max(...scenarios.map((s) => s.cents), 1);

  const basisOptions = [
    {
      v: "avgComplete",
      l: `Avg · ${dataset.completeMonths.length} complete mo`,
    },
    {
      v: "latestComplete",
      l: `Latest · ${
        dataset.completeMonths.length
          ? monthLabel(
              dataset.completeMonths[dataset.completeMonths.length - 1],
              spanMultiYear,
            )
          : "—"
      }`,
    },
    { v: "peakComplete", l: "Peak complete month" },
    ...dataset.completeMonths.map((m) => ({
      v: `month:${m}`,
      l: monthLabel(m, true),
    })),
  ];

  return (
    <div className="space-y-6">
      {/* CONTROLS — the instrument panel */}
      <Card>
        <CardContent className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Assumptions
            </span>
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
            >
              <RotateCcw className="size-3" aria-hidden /> Reset to live
            </button>
          </div>

          {/* Pricing reference — the seat fields default to monthly list
              pricing; billed yearly each seat is cheaper. */}
          <p className="mb-4 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Seat prices are per seat, per month. The fields default to monthly
            list pricing — <span className="text-ink">$25</span> Standard ·{" "}
            <span className="text-ink">$125</span> Premium. Billed yearly, seats
            are cheaper: <span className="text-ink">$20</span> Standard ·{" "}
            <span className="text-ink">$100</span> Premium.
          </p>

          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            <PriceField
              id="std-price"
              label="Standard seat"
              value={standardDollars}
              onChange={setStandardDollars}
            />
            <PriceField
              id="prem-price"
              label="Premium seat"
              value={premiumDollars}
              onChange={setPremiumDollars}
            />

            <div className="space-y-4">
              <ThresholdSlider
                id="api-threshold"
                label="Keep on API <"
                cents={inputs.apiThresholdCents}
                value={apiThresholdDollars}
                max={100}
                onChange={onApiThreshold}
                ariaLabel="API threshold — keep keys spending below this on metered API"
              />
              <ThresholdSlider
                id="threshold"
                label="Premium threshold ≥"
                cents={inputs.premiumThresholdCents}
                value={thresholdDollars}
                max={300}
                onChange={onPremiumThreshold}
                ariaLabel="Premium threshold, dollars per month"
              />
              <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                <span className="text-faint">{result.apiCount}</span> API ·{" "}
                <span className="text-ink">{result.standardCount}</span> Standard
                · <span className="text-ink">{result.premiumCount}</span>{" "}
                Premium
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <ControlLabel htmlFor="basis">Usage basis</ControlLabel>
                <Select value={basisKey} onValueChange={setBasisKey}>
                  <SelectTrigger id="basis" className="mt-2 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {basisOptions.map((o) => (
                      <SelectItem key={o.v} value={o.v}>
                        {o.l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <ControlLabel>Population</ControlLabel>
                <div className="mt-2 inline-flex w-full overflow-hidden rounded-[6px] border border-input">
                  <ToggleButton
                    active={population === "all"}
                    onClick={() => setPopulation("all")}
                  >
                    All {dataset.users.length}
                  </ToggleButton>
                  <ToggleButton
                    active={population === "active"}
                    onClick={() => setPopulation("active")}
                  >
                    Active {activeCount}
                  </ToggleButton>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Keys in scope"
          value={
            <>
              {result.count}
              <span className="text-base text-faint">
                {" "}
                / {dataset.users.length}
              </span>
            </>
          }
          sub={
            population === "active"
              ? "active assignments"
              : `all keys · ${dataset.users.length - activeCount} inactive`
          }
        />
        <Kpi
          label="Current API run-rate"
          value={formatUSD0(result.baselineCents)}
          sub={`per month · ${basisLabel(basisKey, dataset)}`}
        />
        <Kpi
          label="Annualised API spend"
          value={formatUSD0(result.baselineCents * 12)}
          sub={`${formatUSD0(result.baselineCents)} × 12`}
        />
        <Kpi
          label={`Heavy users ≥ ${formatUSD0(inputs.premiumThresholdCents)}`}
          value={result.premiumCount}
          sub={`${result.standardCount} on Standard · ${result.apiCount} kept on API`}
        />
      </div>

      {/* VERDICT — the one expressive moment */}
      <div
        className={cn(
          "flex flex-col gap-1 border-l-2 bg-card px-5 py-4",
          verdictBorder,
        )}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Right-sized verdict
        </p>
        <p className={cn("font-display text-3xl tabular-nums", verdictText)}>
          {savingSign}
          {formatUSD0(Math.abs(saving) * 12)}
          <span className="ml-2 font-mono text-sm text-muted-foreground">
            / year
          </span>
        </p>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {verdictLead} costs{" "}
          <span className="text-ink">
            {formatUSD0(result.rightSizedCents)}/mo
          </span>
          , {verdictPhrase} the {formatUSD0(result.baselineCents)}/mo API
          run-rate.
        </p>
      </div>

      {/* SCENARIO CARDS */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {scenarios.map((s) => {
          const delta = s.cents - result.baselineCents;
          return (
            <Card key={s.title}>
              <CardContent className="p-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
                  {s.tag}
                </p>
                <p className="mt-0.5 text-sm font-medium text-ink">{s.title}</p>
                <p className="mt-3 font-mono text-2xl tabular-nums tracking-tight text-ink">
                  {formatUSD0(s.cents)}
                  <span className="text-sm text-faint"> /mo</span>
                </p>
                <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
                  {formatUSD0(s.cents * 12)} / yr
                </p>
                <div className="mt-3 border-t border-border pt-2.5 text-xs font-medium">
                  {s.isBaseline ? (
                    <span className="text-muted-foreground">baseline</span>
                  ) : Math.abs(delta) < 50 ? (
                    <span className="text-muted-foreground">≈ same as API</span>
                  ) : delta < 0 ? (
                    <span className="text-success">
                      ▼ {formatUSD0(-delta)}/mo saved
                    </span>
                  ) : (
                    <span className="text-destructive">
                      ▲ {formatUSD0(delta)}/mo more
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {s.mix}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* COMPARISON BARS */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Monthly cost comparison
          </p>
          {scenarios.map((s) => (
            <div
              key={s.barLabel}
              className="grid grid-cols-[112px_1fr_auto] items-center gap-3 sm:grid-cols-[140px_1fr_auto]"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-ink">
                  {s.barLabel}
                </p>
                <p className="font-mono text-[10px] uppercase tracking-wide text-faint">
                  {s.barSub}
                </p>
              </div>
              <SegmentedBar
                value={s.cents / maxBar}
                segments={28}
                ariaLabel={`${s.barLabel}: ${formatUSD0(s.cents)} per month`}
              />
              <div className="text-right">
                <p className="font-mono text-sm tabular-nums text-ink">
                  {formatUSD0(s.cents)}
                </p>
                <p className="font-mono text-[10px] tabular-nums text-faint">
                  {formatUSD0(s.cents * 12)}/yr
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* PER-USER TABLE */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  <SortableHead
                    label="User"
                    k="name"
                    sort={sort}
                    onSort={toggleSort}
                    align="left"
                  />
                  <SortableHead
                    label="Status"
                    k="status"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  {displayMonths.map((m) => (
                    <TableHead
                      key={m}
                      className="text-right"
                      title={
                        !partialSet.has(m)
                          ? m
                          : m === latestMonth
                            ? "Current month — month-to-date, excluded from the run-rate"
                            : "Partial month — data collection started mid-month, excluded from the run-rate"
                      }
                    >
                      <span
                        className={cn(
                          "font-mono text-[10px] uppercase tracking-wide",
                          partialSet.has(m) && "text-faint",
                        )}
                      >
                        {monthLabel(m, spanMultiYear)}
                        {partialSet.has(m) ? "·" : ""}
                      </span>
                    </TableHead>
                  ))}
                  <SortableHead
                    label="API basis"
                    k="usage"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHead
                    label="Seat"
                    k="tier"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHead
                    label="Seat $/mo"
                    k="seat"
                    sort={sort}
                    onSort={toggleSort}
                  />
                  <SortableHead
                    label="Δ seat − API"
                    k="delta"
                    sort={sort}
                    onSort={toggleSort}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((r) => (
                  <TableRow key={r.user.userId}>
                    <TableCell>
                      <div className="font-medium text-ink">{r.user.name}</div>
                      <div className="font-mono text-[11px] text-faint">
                        {r.user.workspace ?? "—"}
                        {r.user.internalTier ? ` · ${r.user.internalTier}` : ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={cn(
                          "font-mono text-[11px] uppercase tracking-wide",
                          r.user.status === "active"
                            ? "text-ink"
                            : "text-faint",
                        )}
                      >
                        {r.user.status}
                      </span>
                    </TableCell>
                    {displayMonths.map((m) => {
                      const cents = r.user.monthly[m] ?? 0;
                      return (
                        <TableCell
                          key={m}
                          className="text-right font-mono text-xs tabular-nums text-muted-foreground"
                        >
                          {cents ? formatCurrency(cents) : "·"}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right font-mono text-sm tabular-nums font-medium text-ink">
                      {formatCurrency(r.usageCents)}
                    </TableCell>
                    <TableCell className="text-right">
                      <SeatPill tier={r.tier} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm tabular-nums text-ink">
                      {/* API rows carry cents-precise metered spend; match the
                          API-basis cell's precision so Δ "—" reads consistently.
                          Whole-dollar seat prices stay on formatUSD0. */}
                      {r.tier === "api"
                        ? formatCurrency(r.seatCents)
                        : formatUSD0(r.seatCents)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono text-sm tabular-nums",
                        r.deltaCents < 0
                          ? "text-success"
                          : r.deltaCents > 0
                            ? "text-destructive"
                            : "text-faint",
                      )}
                    >
                      {r.deltaCents === 0
                        ? "—"
                        : `${r.deltaCents < 0 ? "−" : "+"}${formatCurrency(
                            Math.abs(r.deltaCents),
                          )}`}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-medium">
                    Totals · {result.count} keys
                  </TableCell>
                  <TableCell />
                  {displayMonths.map((m) => (
                    <TableCell
                      key={m}
                      className="text-right font-mono text-xs tabular-nums"
                    >
                      {formatUSD0(monthColumnSums[m] ?? 0)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {formatUSD0(result.baselineCents)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {result.premiumCount}P / {result.standardCount}S /{" "}
                    {result.apiCount}A
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">
                    {formatUSD0(result.rightSizedCents)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-sm tabular-nums",
                      deltaText,
                    )}
                  >
                    {savingSign}
                    {formatUSD0(Math.abs(saving))}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </CardContent>
      </Card>

      <p className="font-mono text-[11px] text-faint">
        Figures in USD as billed by Anthropic · spend from
        anthropic_usage_metrics · complete months:{" "}
        {dataset.completeMonths.map((m) => monthLabel(m, true)).join(" · ") ||
          "none yet"}{" "}
        · data assembled {new Date(dataset.generatedAt).toLocaleString()}
      </p>
    </div>
  );
}

/* ---------------------------------- bits --------------------------------- */

function ControlLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
    >
      {children}
    </label>
  );
}

function ThresholdSlider({
  id,
  label,
  cents,
  value,
  max,
  onChange,
  ariaLabel,
}: {
  id: string;
  label: string;
  cents: number;
  value: number;
  max: number;
  onChange: (v: number) => void;
  ariaLabel: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <ControlLabel htmlFor={id}>{label}</ControlLabel>
        <span className="font-mono text-sm tabular-nums text-ink">
          {formatUSD0(cents)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={max}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 w-full cursor-pointer"
        style={{ accentColor: "var(--ink)" }}
        aria-label={ariaLabel}
      />
    </div>
  );
}

function PriceField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <ControlLabel htmlFor={id}>{label}</ControlLabel>
      <div className="mt-2 flex h-10 items-center gap-1.5 rounded-[6px] border border-input bg-card px-3 focus-within:border-ink">
        <span className="font-mono text-sm text-muted-foreground">$</span>
        <input
          id={id}
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(e) =>
            onChange(
              e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)),
            )
          }
          className="w-full bg-transparent font-mono text-base tabular-nums text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="font-mono text-[10px] uppercase tracking-wider text-faint">
          /mo
        </span>
      </div>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex-1 px-2 py-2 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors",
        active
          ? "bg-ink text-background"
          : "bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Kpi({
  label,
  value,
  sub,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-2 font-mono text-2xl tabular-nums tracking-tight text-ink">
          {value}
        </p>
        {sub ? (
          <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SeatPill({ tier }: { tier: SeatTier }) {
  const { className, label } = SEAT_PILL[tier];
  return (
    <span
      className={cn(
        "inline-block rounded-[4px] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]",
        className,
      )}
    >
      {label}
    </span>
  );
}

function SortableHead({
  label,
  k,
  sort,
  onSort,
  align = "right",
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  return (
    <TableHead
      aria-sort={
        active ? (sort.dir === 1 ? "ascending" : "descending") : "none"
      }
      className={align === "left" ? "text-left" : "text-right"}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          "inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide transition-colors hover:text-foreground",
          align === "left" ? "flex-row" : "flex-row-reverse",
          active ? "text-ink" : "text-muted-foreground",
        )}
      >
        {label}
        {active ? (
          sort.dir === 1 ? (
            <ArrowUp className="size-3" aria-hidden />
          ) : (
            <ArrowDown className="size-3" aria-hidden />
          )
        ) : (
          <ChevronsUpDown className="size-3 opacity-40" aria-hidden />
        )}
      </button>
    </TableHead>
  );
}
