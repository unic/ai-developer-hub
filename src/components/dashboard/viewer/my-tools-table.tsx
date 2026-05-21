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
import { formatCurrency, formatDate } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import type { ViewerToolRow } from "@/actions/dashboard";

interface MyToolsTableProps {
  tools: ViewerToolRow[];
}

export function MyToolsTable({ tools }: MyToolsTableProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle>My tools &amp; licenses</CardTitle>
          <CardDescription>Tools currently assigned to you</CardDescription>
        </div>
        <Link
          href="/assignments"
          className="text-xs text-primary underline-offset-2 hover:underline"
        >
          All my assignments →
        </Link>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Monthly</TableHead>
                <TableHead className="text-right">Assigned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tools.map((tool) => (
                <TableRow key={tool.id}>
                  <TableCell>
                    <div className="font-medium">{tool.toolName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {tool.vendor}
                      {tool.isAnthropic && tool.hasApiKey
                        ? " · API key configured"
                        : ""}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {tool.tierName}
                  </TableCell>
                  <TableCell>
                    {tool.status === "active" ? (
                      <Badge variant="default">active</Badge>
                    ) : (
                      <span>
                        <Badge variant="secondary">inactive</Badge>
                        {tool.revokedAt && (
                          <span className="ml-2 text-[11px] text-muted-foreground">
                            revoked {formatDistanceToNow(new Date(tool.revokedAt), { addSuffix: true })}
                          </span>
                        )}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatCurrency(tool.costCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatDate(new Date(tool.assignedAt))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
