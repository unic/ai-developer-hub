"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { bulkImportUsers, checkExistingUsers } from "@/actions/users";
import type { ExistingUserFields } from "@/types";
import { getChangedUserFields } from "@/lib/utils";
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
  action?: "new" | "update";
  changes?: string[];
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

function enrichRows(
  rows: ParsedUser[],
  existingMap: Record<string, ExistingUserFields>
): ParsedUser[] {
  return rows.map((row) => {
    if (!row.valid) return row;
    const existing = existingMap[row.email.toLowerCase()];
    if (!existing) return { ...row, action: "new" as const, changes: [] };

    const changes = getChangedUserFields(row, existing);
    return { ...row, action: "update" as const, changes };
  });
}

export function BulkImportForm() {
  const router = useRouter();
  const [parsedUsers, setParsedUsers] = useState<ParsedUser[]>([]);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inviteLinks, setInviteLinks] = useState<Array<{ name: string; email: string; inviteUrl: string }>>([]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const text = event.target?.result as string;
      const rows = parseCSV(text);

      // Look up existing users for preview labeling
      const validEmails = rows.filter((r) => r.valid).map((r) => r.email);
      if (validEmails.length > 0) {
        setLoading(true);
        try {
          const result = await checkExistingUsers({ emails: validEmails });
          if (result.success) {
            setParsedUsers(enrichRows(rows, result.data));
            return;
          }
          toast.error("Failed to check existing users");
        } catch {
          toast.error("Failed to check existing users");
        } finally {
          setLoading(false);
        }
      }
      setParsedUsers(rows);
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
      if (result.data.inviteLinks && result.data.inviteLinks.length > 0) {
        setInviteLinks(result.data.inviteLinks);
      } else if (created > 0 || updated > 0) {
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
            New users will receive an invite link to set their password. Existing
            users (matched by email) are updated without changing their password.
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

      {inviteLinks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Invite Links</CardTitle>
            <CardDescription>
              {inviteLinks.length} new user(s) created. Download the invite links CSV to share with them,
              or go to the Users page to send invite emails.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <Button
                onClick={() => {
                  const header = "Name,Email,Invite Link";
                  const rows = inviteLinks.map(
                    (l) => `"${l.name}","${l.email}","${l.inviteUrl}"`
                  );
                  const csv = [header, ...rows].join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "invite-links.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="mr-2 size-4" />
                Download Invite Links CSV
              </Button>
              <Button variant="outline" onClick={() => router.push("/users")}>
                Go to Users
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
                    <TableHead>Action</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Circle</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>GitHub</TableHead>
                    <TableHead>Profile</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedUsers.map((user, i) => {
                    const changed = user.changes ?? [];
                    const hl = "font-semibold text-primary";
                    return (
                      <TableRow
                        key={i}
                        className={!user.valid ? "bg-destructive/10" : ""}
                      >
                        <TableCell>
                          {user.action === "update" ? (
                            <Badge variant="secondary">Update</Badge>
                          ) : user.action === "new" ? (
                            <Badge variant="outline">New</Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className={changed.includes("name") ? hl : ""}>{user.name}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell className={changed.includes("circle") ? hl : ""}>{user.circle}</TableCell>
                        <TableCell className={changed.includes("role") ? hl : ""}>{user.role}</TableCell>
                        <TableCell className={changed.includes("githubUsername") ? hl : ""}>{user.githubUsername || "\u2014"}</TableCell>
                        <TableCell className={changed.includes("profile") ? hl : ""}>{user.profile || "\u2014"}</TableCell>
                        <TableCell>
                          {user.valid ? (
                            <Badge>Valid</Badge>
                          ) : (
                            <Badge variant="destructive">{user.error}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 flex gap-3">
              <Button
                onClick={handleImport}
                disabled={importing || loading || validCount === 0}
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
