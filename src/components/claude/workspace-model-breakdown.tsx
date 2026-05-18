import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ModelBreakdownRow } from "@/types";
import { formatCurrency } from "@/lib/utils";

const PALETTE = [
  "#c084fc",
  "#67e8f9",
  "#86efac",
  "#fcd34d",
  "#f9a8d4",
  "#93c5fd",
];

/**
 * Reused by the per-user drill page with `scopeLabel="User"`. The component
 * is otherwise identical — same palette, same reconciliation footnote, same
 * stacked-bar+table layout.
 */
export function WorkspaceModelBreakdown({
  rows,
  scopeLabel = "Workspace",
}: {
  rows: ModelBreakdownRow[];
  scopeLabel?: "Workspace" | "User";
}) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No model-level data for this {scopeLabel.toLowerCase()}.
      </p>
    );
  }

  const total = rows.reduce((s, r) => s + r.costCents, 0);

  return (
    <div className="space-y-3">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label="Stacked bar showing model cost distribution"
      >
        {rows.map((r, i) => {
          const widthPct = total === 0 ? 0 : (r.costCents / total) * 100;
          return (
            <div
              key={r.modelName}
              style={{
                width: `${widthPct}%`,
                backgroundColor: PALETTE[i % PALETTE.length],
              }}
              title={`${r.modelName} · ${formatCurrency(r.costCents)} · ${r.pct}%`}
            />
          );
        })}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Tokens In</TableHead>
            <TableHead className="text-right">Tokens Out</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead className="text-right">% {scopeLabel}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.modelName}>
              <TableCell className="font-medium">
                <span className="mr-2 inline-block size-2 rounded-sm align-middle" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                {r.modelName}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {r.tokensIn.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {r.tokensOut.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(r.costCents)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {r.pct}%
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Model-level totals come from Anthropic&apos;s usage endpoint and may not
        exactly match the {scopeLabel.toLowerCase()} headline cost (different
        rounding and aggregation windows).
      </p>
    </div>
  );
}
