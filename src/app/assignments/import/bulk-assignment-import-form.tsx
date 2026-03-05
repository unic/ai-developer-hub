"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { bulkImportAssignments } from "@/actions/assignments";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface ParsedAssignment {
  email: string;
  tool: string;
  tier: string;
  workspace: string;
  apiKey: string;
  assignedAt: string;
  valid: boolean;
  error?: string;
}

function maskApiKey(key: string): string {
  if (!key) return "";
  return key.length > 8 ? key.slice(0, 4) + "••••••••" : "••••••••";
}

function parseCSV(text: string): ParsedAssignment[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());

  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());

    const email = values[headers.indexOf("email")] ?? "";
    const tool = values[headers.indexOf("tool")] ?? "";
    const tier = values[headers.indexOf("tier")] ?? "";
    const workspace = values[headers.indexOf("workspace")] ?? "";
    const apiKey = values[headers.indexOf("api_key")] ?? "";
    const assignedAt = values[headers.indexOf("assigned_at")] ?? "";

    const errors: string[] = [];
    if (!email.includes("@")) errors.push("Invalid email");
    if (!tool) errors.push("Tool is required");
    if (!tier) errors.push("Tier is required");
    if (!workspace) errors.push("Workspace is required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(assignedAt))
      errors.push("Invalid date (YYYY-MM-DD)");

    return {
      email,
      tool,
      tier,
      workspace,
      apiKey,
      assignedAt,
      valid: errors.length === 0,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    };
  });
}

export function BulkAssignmentImportForm() {
  const router = useRouter();
  const [rows, setRows] = useState<ParsedAssignment[]>([]);
  const [importing, setImporting] = useState(false);

  const validCount = rows.filter((r) => r.valid).length;
  const invalidCount = rows.filter((r) => !r.valid).length;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setRows(parseCSV(text));
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    const validRows = rows.filter((r) => r.valid);
    if (validRows.length === 0) return;

    setImporting(true);
    try {
      const assignments = validRows.map((r) => ({
        email: r.email,
        tool: r.tool,
        tier: r.tier,
        workspace: r.workspace,
        ...(r.apiKey ? { apiKey: r.apiKey } : {}),
        assignedAt: r.assignedAt,
      }));

      const result = await bulkImportAssignments({ assignments });

      if (result.success) {
        const imported = result.data?.imported ?? 0;
        const failed = result.data?.failed ?? 0;
        toast.success(
          `Import complete: ${imported} imported, ${failed} failed`
        );
        router.push("/assignments");
      } else {
        toast.error(result.error ?? "Import failed");
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Bulk Import Assignments</h1>
        <p className="text-muted-foreground">
          Upload a CSV file to import license assignments in bulk.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload CSV</CardTitle>
          <CardDescription>
            CSV columns: email, tool, tier, workspace, api_key, assigned_at
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
          />

          {rows.length > 0 && (
            <>
              <p className="text-sm text-muted-foreground">
                {validCount} valid, {invalidCount} invalid of {rows.length}{" "}
                total
              </p>

              <div className="max-h-96 overflow-auto rounded border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Tool</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Workspace</TableHead>
                      <TableHead>API Key</TableHead>
                      <TableHead>Assigned At</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, idx) => (
                      <TableRow
                        key={idx}
                        className={row.valid ? "" : "bg-destructive/10"}
                      >
                        <TableCell>{row.email}</TableCell>
                        <TableCell>{row.tool}</TableCell>
                        <TableCell>{row.tier}</TableCell>
                        <TableCell>{row.workspace}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {maskApiKey(row.apiKey)}
                        </TableCell>
                        <TableCell>{row.assignedAt}</TableCell>
                        <TableCell>
                          {row.valid ? (
                            <Badge variant="default">Valid</Badge>
                          ) : (
                            <Badge variant="destructive">{row.error}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleImport}
                  disabled={validCount === 0 || importing}
                >
                  {importing
                    ? "Importing..."
                    : `Import ${validCount} Assignment(s)`}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push("/assignments")}
                >
                  Cancel
                </Button>
              </div>
            </>
          )}

          {rows.length === 0 && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => router.push("/assignments")}
              >
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
