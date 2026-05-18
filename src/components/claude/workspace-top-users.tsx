import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { WorkspaceUser } from "@/types";
import { formatCurrency } from "@/lib/utils";

export function WorkspaceTopUsers({ users }: { users: WorkspaceUser[] }) {
  if (users.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No per-user data yet for this workspace.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.userId}>
              <TableCell className="font-medium">
                <Link
                  href={`/profile?userId=${u.userId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {u.name || u.email}
                </Link>
                <p className="text-xs text-muted-foreground">{u.email}</p>
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {u.requestCount.toLocaleString()}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(u.costCents)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="px-1 text-[11px] text-muted-foreground">
        Per-user totals come from Anthropic&apos;s usage endpoint and will not
        exactly match the workspace headline cost (different rounding and
        aggregation windows). Mid-month workspace moves attribute historical
        usage to the user&apos;s current workspace.
      </p>
    </div>
  );
}
