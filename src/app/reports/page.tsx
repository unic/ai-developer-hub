import { getAssignments } from "@/actions/assignments";
import { getTools } from "@/actions/tools";
import { getUsers } from "@/actions/users";
import { formatCurrency } from "@/lib/utils";
import { AuthGuard } from "@/components/auth-guard";
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

export default async function ReportsPage() {
  const [assignments, tools, userList] = await Promise.all([
    getAssignments(),
    getTools(),
    getUsers(),
  ]);

  const activeAssignments = assignments.filter((a) => a.status === "active");

  // Tool adoption summary
  const toolSummary = tools.map((tool) => {
    const toolAssignments = activeAssignments.filter(
      (a) => a.tool.id === tool.id
    );
    const totalCost = toolAssignments.reduce(
      (s, a) => s + a.costAtAssignmentCents,
      0
    );
    return {
      id: tool.id,
      name: tool.name,
      vendor: tool.vendor,
      activeUsers: toolAssignments.length,
      totalMonthlyCost: totalCost,
    };
  });

  // Circle breakdown
  const circles = [...new Set(userList.map((u) => u.circle))];
  const circleReport = circles.map((circle) => {
    const circleUsers = userList.filter((u) => u.circle === circle);
    const circleUserIds = new Set(circleUsers.map((u) => u.id));
    const circleAssignments = activeAssignments.filter((a) =>
      circleUserIds.has(a.user.id)
    );
    const totalCost = circleAssignments.reduce(
      (s, a) => s + a.costAtAssignmentCents,
      0
    );
    return {
      circle,
      userCount: circleUsers.length,
      licenseCount: circleAssignments.length,
      totalMonthlyCost: totalCost,
    };
  });

  const totalActiveUsers = userList.filter((u) => u.status === "active").length;
  const totalActiveTools = tools.filter((t) => t.status === "active").length;
  const totalMonthlySpend = activeAssignments.reduce(
    (s, a) => s + a.costAtAssignmentCents,
    0
  );

  return (
    <AuthGuard requiredRole="admin">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Reports</h1>
          <p className="text-muted-foreground">
            Tool adoption, license utilization, and spending insights
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Active Users</p>
              <p className="text-2xl font-bold">{totalActiveUsers}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Active Tools</p>
              <p className="text-2xl font-bold">{totalActiveTools}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Active Licenses</p>
              <p className="text-2xl font-bold">{activeAssignments.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Monthly Spend</p>
              <p className="text-2xl font-bold">
                {formatCurrency(totalMonthlySpend)}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Tool Adoption Summary</CardTitle>
            <CardDescription>
              Active license count and monthly cost per tool
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tool</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Active Users</TableHead>
                    <TableHead>Monthly Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {toolSummary
                    .sort((a, b) => b.totalMonthlyCost - a.totalMonthlyCost)
                    .map((tool) => (
                      <TableRow key={tool.id}>
                        <TableCell className="font-medium">
                          {tool.name}
                        </TableCell>
                        <TableCell>{tool.vendor}</TableCell>
                        <TableCell>{tool.activeUsers}</TableCell>
                        <TableCell>
                          {formatCurrency(tool.totalMonthlyCost)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Circle Report</CardTitle>
            <CardDescription>
              License distribution and cost by circle
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Circle</TableHead>
                    <TableHead>Users</TableHead>
                    <TableHead>Licenses</TableHead>
                    <TableHead>Monthly Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {circleReport
                    .sort((a, b) => b.totalMonthlyCost - a.totalMonthlyCost)
                    .map((item) => (
                      <TableRow key={item.circle}>
                        <TableCell className="font-medium">
                          {item.circle}
                        </TableCell>
                        <TableCell>{item.userCount}</TableCell>
                        <TableCell>{item.licenseCount}</TableCell>
                        <TableCell>
                          {formatCurrency(item.totalMonthlyCost)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AuthGuard>
  );
}
