import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UserModelBreakdownRow } from "@/types";
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
 * Per-user model breakdown. Mirrors `WorkspaceModelBreakdown` — horizontal
 * stacked bar + legend table — but the percentage column is scoped to the
 * user's own cost (not the workspace's). The reconciliation footnote is
 * identical in spirit: per-user numbers and workspace-level cost reports come
 * from different Anthropic endpoints and will not reconcile exactly.
 */
export function UserModelBreakdown({
  rows,
}: {
  rows: UserModelBreakdownRow[];
}) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No model-level data for this user.
      </p>
    );
  }

  const total = rows.reduce((s, r) => s + r.costCents, 0);

  return (
    <div className="space-y-3">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label="Stacked bar showing model cost distribution for this user"
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
              title={`${r.modelName} · ${formatCurrency(r.costCents)} · ${r.pctOfUser}%`}
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
            <TableHead className="text-right">% User</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.modelName}>
              <TableCell className="font-medium">
                <span
                  className="mr-2 inline-block size-2 rounded-sm align-middle"
                  style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                />
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
                {r.pctOfUser}%
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Token counts and cost come from Anthropic&apos;s per-user usage
        endpoint; workspace-level totals come from a separate cost endpoint and
        may not exactly match.
      </p>
    </div>
  );
}
