import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import type { ToolSummaryItem } from "@/types";

interface TopToolsCardProps {
  toolSummary: ToolSummaryItem[];
  previousAssignmentsByTool: Record<number, number>;
}

export function TopToolsCard({
  toolSummary,
  previousAssignmentsByTool,
}: TopToolsCardProps) {
  const top = [...toolSummary]
    .filter((t) => t.activeUsers > 0)
    .sort((a, b) => b.totalMonthlyCost - a.totalMonthlyCost)
    .slice(0, 5);

  if (top.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top tools by spend</CardTitle>
          <CardDescription>Current month · sorted by total cost</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No active assignments yet.{" "}
            <Link href="/assignments" className="underline">
              Add some →
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Top tools by spend</CardTitle>
          <CardDescription>Current month · sorted by total cost</CardDescription>
        </div>
        <Link
          href="/tools"
          className="text-xs text-primary underline-offset-2 hover:underline"
        >
          All tools →
        </Link>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Users</TableHead>
                <TableHead className="text-right">MoM</TableHead>
                <TableHead className="text-right">Monthly</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((tool) => {
                const prior = previousAssignmentsByTool[tool.id];
                const delta =
                  prior !== undefined ? tool.activeUsers - prior : null;
                return (
                  <TableRow key={tool.id}>
                    <TableCell className="font-medium">{tool.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {tool.vendor}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {tool.activeUsers}
                    </TableCell>
                    <TableCell className="text-right">
                      {delta === null ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : delta === 0 ? (
                        <Badge
                          variant="secondary"
                          className="font-mono text-[11px]"
                        >
                          ±0
                        </Badge>
                      ) : (
                        <Badge
                          variant={delta > 0 ? "destructive" : "default"}
                          className="font-mono text-[11px]"
                        >
                          {delta > 0 ? "+" : ""}
                          {delta}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(tool.totalMonthlyCost)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
