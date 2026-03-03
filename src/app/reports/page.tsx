import { getAssignments } from "@/actions/assignments";
import { getTools } from "@/actions/tools";
import { getUsers } from "@/actions/users";
import { formatCurrency } from "@/lib/utils";
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

  // Department breakdown
  const departments = [...new Set(userList.map((u) => u.department))];
  const deptReport = departments.map((dept) => {
    const deptUsers = userList.filter((u) => u.department === dept);
    const deptUserIds = new Set(deptUsers.map((u) => u.id));
    const deptAssignments = activeAssignments.filter((a) =>
      deptUserIds.has(a.user.id)
    );
    const totalCost = deptAssignments.reduce(
      (s, a) => s + a.costAtAssignmentCents,
      0
    );
    return {
      department: dept,
      userCount: deptUsers.length,
      licenseCount: deptAssignments.length,
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
          <CardTitle>Department Report</CardTitle>
          <CardDescription>
            License distribution and cost by department
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Users</TableHead>
                  <TableHead>Licenses</TableHead>
                  <TableHead>Monthly Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deptReport
                  .sort((a, b) => b.totalMonthlyCost - a.totalMonthlyCost)
                  .map((dept) => (
                    <TableRow key={dept.department}>
                      <TableCell className="font-medium">
                        {dept.department}
                      </TableCell>
                      <TableCell>{dept.userCount}</TableCell>
                      <TableCell>{dept.licenseCount}</TableCell>
                      <TableCell>
                        {formatCurrency(dept.totalMonthlyCost)}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
