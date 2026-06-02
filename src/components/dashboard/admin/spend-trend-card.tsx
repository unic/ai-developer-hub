"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatCurrency } from "@/lib/utils";
import { shortMonth } from "@/lib/reports/period-helpers";
import type { AdminSpendSeriesPoint } from "@/actions/dashboard";

interface SpendTrendCardProps {
  spendSeries: AdminSpendSeriesPoint[];
  billedYtdCents: number;
}

const chartConfig: ChartConfig = {
  licenses: { label: "Licenses (billed)", color: "var(--chart-1)" },
  api: { label: "Anthropic API (running)", color: "var(--chart-2)" },
};

export function SpendTrendCard({
  spendSeries,
  billedYtdCents,
}: SpendTrendCardProps) {
  if (spendSeries.length === 0) {
    return null;
  }

  const data = spendSeries.map((p) => ({
    month: shortMonth(p.periodLabel),
    licenses: p.licensesCents,
    api: p.apiCents,
    isForecast: p.isForecast,
  }));

  const totalApi = spendSeries.reduce(
    (s, p) => s + (p.isForecast ? 0 : p.apiCents),
    0,
  );
  const totalLicensesYtd = billedYtdCents;
  const grandTotal = totalLicensesYtd + totalApi || 1;
  const licensesPct = Math.round((totalLicensesYtd / grandTotal) * 100);
  const apiPct = 100 - licensesPct;

  // Average of past + current months only — future periods have no actual
  // billed data and would drag the reference line down toward zero.
  const billedMonths = spendSeries.filter((p) => !p.isForecast);
  const avgMonthlyActual =
    billedMonths.length > 0
      ? billedMonths.reduce((s, p) => s + p.licensesCents + p.apiCents, 0) /
        billedMonths.length
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spend over time</CardTitle>
        <CardDescription>
          Stacked monthly cost · Licenses (billed) + Anthropic API (running) ·
          last 12 months
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:grid-cols-[1fr_220px]">
          <ChartContainer
            config={chartConfig}
            className="h-[260px] w-full min-w-0"
          >
            <BarChart
              data={data}
              margin={{ top: 16, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
              />
              <YAxis
                tickFormatter={(v) => `$${(Number(v) / 100_000).toFixed(0)}k`}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              {avgMonthlyActual > 0 && (
                <ReferenceLine
                  y={avgMonthlyActual}
                  stroke="var(--chart-3)"
                  strokeDasharray="6 4"
                  strokeOpacity={0.5}
                />
              )}
              <ChartTooltip
                cursor={{ fill: "var(--muted)", opacity: 0.2 }}
                content={
                  <ChartTooltipContent
                    labelKey="month"
                    showTotal
                    totalLabel="Total"
                    valueFormatter={(v) => formatCurrency(Number(v))}
                    secondaryFormatter={(v, _item, total) => {
                      const n = Number(v);
                      if (!Number.isFinite(n) || total === 0) return null;
                      return `${Math.round((n / total) * 100)}%`;
                    }}
                  />
                }
              />
              <Bar
                dataKey="licenses"
                stackId="actual"
                fill="var(--color-licenses)"
              >
                {data.map((d, i) => (
                  <Cell
                    key={`lic-${i}`}
                    fill="var(--color-licenses)"
                    fillOpacity={d.isForecast ? 0.35 : 1}
                  />
                ))}
              </Bar>
              <Bar dataKey="api" stackId="actual" fill="var(--color-api)">
                {data.map((d, i) => (
                  <Cell
                    key={`api-${i}`}
                    fill="var(--color-api)"
                    fillOpacity={d.isForecast ? 0.3 : 0.85}
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>

          <div className="flex flex-col gap-3 border-l pl-5">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                YTD billed
              </p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums">
                {formatCurrency(billedYtdCents)}
              </p>
            </div>
            <div className="space-y-2">
              <LegendRow
                color="var(--chart-1)"
                label="Licenses"
                value={formatCurrency(totalLicensesYtd)}
                share={licensesPct}
              />
              <LegendRow
                color="var(--chart-2)"
                label="Anthropic API"
                value={formatCurrency(totalApi)}
                share={apiPct}
              />
            </div>
            <p className="mt-2 border-t pt-3 text-[11px] text-muted-foreground">
              Fading bars represent future periods with no billed data yet.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LegendRow({
  color,
  label,
  value,
  share,
}: {
  color: string;
  label: string;
  value: string;
  share: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-2">
        <span
          className="inline-block size-2.5 rounded-full"
          style={{ background: color }}
        />
        <span className="text-foreground">{label}</span>
      </span>
      <div className="text-right">
        <p className="tabular-nums">{value}</p>
        <p className="text-[10px] text-muted-foreground tabular-nums">
          {share}%
        </p>
      </div>
    </div>
  );
}
