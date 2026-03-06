"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { bulkImportUsers } from "@/actions/users";
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
import { Download } from "lucide-react";

interface ParsedUser {
  name: string;
  email: string;
  circle: string;
  role: string;
  githubUsername: string;
  profile: string;
  valid: boolean;
  error?: string;
}

function parseCSV(text: string): ParsedUser[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());

  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] || "";
    });

    const rawRole = (row.role || "").trim().toLowerCase();
    const validRoles = ["admin", "viewer"];
    const rawProfile = (row.profile || "").trim().toLowerCase();
    const validProfiles = ["boost", "maxed", "indie"];

    const user: ParsedUser = {
      name: row.name || "",
      email: row.email || "",
      circle: row.circle || row.department || "",
      role: rawRole || "viewer",
      githubUsername: row.github_username || row.githubusername || "",
      profile: (row.profile || "").trim().toLowerCase(),
      valid: true,
    };

    if (!user.name) {
      user.valid = false;
      user.error = "Name is required";
    } else if (!user.email || !user.email.includes("@")) {
      user.valid = false;
      user.error = "Valid email is required";
    } else if (rawRole && !validRoles.includes(rawRole)) {
      user.valid = false;
      user.error = "Role must be 'admin' or 'viewer'";
    } else if (rawProfile && !validProfiles.includes(rawProfile)) {
      user.valid = false;
      user.error = "Profile must be 'boost', 'maxed', or 'indie'";
    }

    return user;
  });
}

export function BulkImportForm() {
  const router = useRouter();
  const [parsedUsers, setParsedUsers] = useState<ParsedUser[]>([]);
  const [importing, setImporting] = useState(false);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setParsedUsers(parseCSV(text));
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    const validUsers = parsedUsers
      .filter((u) => u.valid)
      .map(({ name, email, circle, role, githubUsername, profile }) => ({
        name,
        email,
        circle: circle || undefined,
        role,
        githubUsername: githubUsername || undefined,
        profile: profile || undefined,
      }));

    if (validUsers.length === 0) {
      toast.error("No valid users to import");
      return;
    }

    setImporting(true);
    const result = await bulkImportUsers({ users: validUsers });
    setImporting(false);

    if (result.success) {
      const { created, updated, skipped, failed } = result.data;
      const parts: string[] = [];
      if (created > 0) parts.push(`${created} created`);
      if (updated > 0) parts.push(`${updated} updated`);
      if (skipped > 0) parts.push(`${skipped} skipped`);
      if (failed > 0) parts.push(`${failed} failed`);
      toast.success(parts.join(", ") || "No changes");
      if (created > 0 || updated > 0) {
        router.push("/users");
      }
    } else {
      toast.error(result.error);
    }
  }

  const validCount = parsedUsers.filter((u) => u.valid).length;
  const invalidCount = parsedUsers.length - validCount;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Bulk Import Users</h1>
          <p className="text-muted-foreground">
            Upload a CSV file with columns: name, email (required); circle (or
            department), role, github_username, profile (optional)
          </p>
        </div>
        <Button variant="outline" asChild>
          <a href="/api/export/users" download>
            <Download className="mr-2 h-4 w-4" />
            Export Current Users
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload CSV</CardTitle>
          <CardDescription>
            New users get default password &quot;changeme123&quot;. Existing users
            (matched by email) are updated without changing their password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="max-w-sm"
          />
        </CardContent>
      </Card>

      {parsedUsers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              {validCount} valid, {invalidCount} invalid of{" "}
              {parsedUsers.length} total
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Circle</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Profile</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedUsers.map((user, i) => (
                    <TableRow
                      key={i}
                      className={!user.valid ? "bg-destructive/10" : ""}
                    >
                      <TableCell>{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell>{user.circle}</TableCell>
                      <TableCell>{user.role}</TableCell>
                      <TableCell>{user.profile || "\u2014"}</TableCell>
                      <TableCell>
                        {user.valid ? (
                          <Badge>Valid</Badge>
                        ) : (
                          <Badge variant="destructive">{user.error}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 flex gap-3">
              <Button
                onClick={handleImport}
                disabled={importing || validCount === 0}
              >
                {importing
                  ? "Importing..."
                  : `Import ${validCount} User(s)`}
              </Button>
              <Button
                variant="outline"
                onClick={() => router.push("/users")}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
