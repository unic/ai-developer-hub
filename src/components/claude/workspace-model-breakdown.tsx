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

export function WorkspaceModelBreakdown({
  rows,
}: {
  rows: ModelBreakdownRow[];
}) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No model-level data for this workspace.
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
              title={`${r.modelName} · ${formatCurrency(r.costCents)} · ${r.pctOfWorkspace}%`}
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
            <TableHead className="text-right">% Workspace</TableHead>
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
                {r.pctOfWorkspace}%
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
