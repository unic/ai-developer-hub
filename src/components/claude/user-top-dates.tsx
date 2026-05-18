import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UserTopDateRow } from "@/types";
import { formatCurrency } from "@/lib/utils";

/**
 * Top 5 highest-cost days in the selected month for a single user.
 *
 * - Renders nothing-but-an-empty-state line when the user has zero usage.
 * - Renders fewer than 5 rows gracefully when the user has fewer active days.
 * - The "dominant model" column shows the model that contributed the largest
 *   share of cost on that day (helper: `dominantModelPerDay`).
 */
export function UserTopDates({ rows }: { rows: UserTopDateRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No usage this month.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Dominant model</TableHead>
          <TableHead className="text-right">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.date}>
            <TableCell className="font-medium">
              {formatDateLabel(r.date)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {r.dominantModel ?? "—"}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCurrency(r.costCents)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function formatDateLabel(isoDate: string): string {
  // Parse as local — calendar dates have no timezone, but a UTC parse can
  // shift the label by a day for west-of-UTC viewers.
  const d = new Date(`${isoDate}T00:00:00`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
