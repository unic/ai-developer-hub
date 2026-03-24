"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, ExternalLink, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { fetchGitHubSyncPreview, confirmGitHubSync } from "@/actions/github-sync";
import type {
  SyncPreview,
  SyncMatchedMember,
  SyncUnmatchedMember,
  SyncUnmatchedSystemUser,
} from "@/types";

interface GitHubMemberSyncSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GitHubMemberSyncSheet({
  open,
  onOpenChange,
}: GitHubMemberSyncSheetProps) {
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const result = await fetchGitHubSyncPreview();
      if (result.success) {
        setPreview(result.data);
      } else {
        setError(result.error);
      }
    } catch {
      setError("Failed to fetch sync preview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadPreview();
    } else {
      // Reset state when closed
      setPreview(null);
      setError(null);
    }
  }, [open, loadPreview]);

  async function handleConfirm() {
    setConfirming(true);
    try {
      const result = await confirmGitHubSync({
        importGitHubLogins: [],
        manualMatches: [],
        newUsers: [],
      });
      if (result.success) {
        const { enrichedCount, importedCount, skippedCount } = result.data;
        toast.success(
          `Sync complete: ${enrichedCount} enriched, ${importedCount} imported, ${skippedCount} skipped`
        );
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to confirm sync");
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl w-full overflow-y-auto">
        <SheetHeader>
          <SheetTitle>GitHub Member Sync</SheetTitle>
          <SheetDescription>
            Preview and confirm syncing GitHub organization members with system
            users.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Fetching organization members...
              </p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <AlertTriangle className="size-8 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={loadPreview}>
                Retry
              </Button>
            </div>
          )}

          {preview && (
            <>
              {/* Summary counts */}
              <div className="grid grid-cols-3 gap-3">
                <SummaryCard
                  label="Matched"
                  count={preview.matched.length}
                  variant="default"
                />
                <SummaryCard
                  label="Unmatched GitHub"
                  count={preview.unmatched.length}
                  variant={preview.unmatched.length > 0 ? "warning" : "default"}
                />
                <SummaryCard
                  label="Unmatched System"
                  count={preview.unmatchedSystemUsers.length}
                  variant={
                    preview.unmatchedSystemUsers.length > 0
                      ? "warning"
                      : "default"
                  }
                />
              </div>

              {preview.conflicts.length > 0 && (
                <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3">
                  <p className="text-sm font-medium text-destructive">
                    {preview.conflicts.length} conflict(s) detected
                  </p>
                  <ul className="mt-1 space-y-1">
                    {preview.conflicts.map((c) => (
                      <li
                        key={c.githubLogin}
                        className="text-xs text-muted-foreground"
                      >
                        {c.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Tabs */}
              <Tabs defaultValue="matched">
                <TabsList className="w-full">
                  <TabsTrigger value="matched" className="flex-1">
                    Matched ({preview.matched.length})
                  </TabsTrigger>
                  <TabsTrigger value="unmatched-github" className="flex-1">
                    Unmatched GitHub ({preview.unmatched.length})
                  </TabsTrigger>
                  <TabsTrigger value="unmatched-system" className="flex-1">
                    Unmatched System ({preview.unmatchedSystemUsers.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="matched" className="mt-4">
                  <MatchedTable members={preview.matched} />
                </TabsContent>

                <TabsContent value="unmatched-github" className="mt-4">
                  <UnmatchedGitHubList members={preview.unmatched} />
                </TabsContent>

                <TabsContent value="unmatched-system" className="mt-4">
                  <UnmatchedSystemList users={preview.unmatchedSystemUsers} />
                </TabsContent>
              </Tabs>

              {/* Confirm button */}
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={confirming}
                >
                  Cancel
                </Button>
                <Button onClick={handleConfirm} disabled={confirming}>
                  {confirming ? (
                    <>
                      <Loader2 className="size-4 mr-2 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="size-4 mr-2" />
                      Confirm Sync
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SummaryCard({
  label,
  count,
  variant,
}: {
  label: string;
  count: number;
  variant: "default" | "warning";
}) {
  return (
    <div className="rounded-md border p-3 text-center">
      <p className="text-2xl font-bold tabular-nums">{count}</p>
      <p
        className={`text-xs ${
          variant === "warning" && count > 0
            ? "text-amber-600 dark:text-amber-400 font-medium"
            : "text-muted-foreground"
        }`}
      >
        {label}
      </p>
    </div>
  );
}

function MatchedTable({ members }: { members: SyncMatchedMember[] }) {
  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        No matched members found.
      </p>
    );
  }

  return (
    <div className="rounded-md border max-h-80 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>GitHub User</TableHead>
            <TableHead>System User</TableHead>
            <TableHead>Match Type</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.githubLogin}>
              <TableCell>
                <div className="flex items-center gap-2">
                  {m.githubAvatarUrl && (
                    <Image
                      src={m.githubAvatarUrl}
                      alt=""
                      width={24}
                      height={24}
                      className="size-6 rounded-full"
                      unoptimized
                    />
                  )}
                  <span className="text-sm font-medium">{m.githubLogin}</span>
                </div>
              </TableCell>
              <TableCell>
                <div className="text-sm">
                  <p className="font-medium">{m.matchedUserName}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.matchedUserEmail}
                  </p>
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className="text-xs">
                  {m.matchType}
                </Badge>
                {m.hasConflict && (
                  <Badge variant="destructive" className="text-xs ml-1">
                    conflict
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function UnmatchedGitHubList({ members }: { members: SyncUnmatchedMember[] }) {
  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        All GitHub members are matched.
      </p>
    );
  }

  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      {members.map((m) => (
        <div
          key={m.githubLogin}
          className="flex items-center gap-3 rounded-md border p-3"
        >
          {m.githubAvatarUrl && (
            <Image
              src={m.githubAvatarUrl}
              alt=""
              width={32}
              height={32}
              className="size-8 rounded-full shrink-0"
              unoptimized
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium truncate">{m.githubLogin}</p>
              <a
                href={m.githubProfileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <ExternalLink className="size-3.5" />
              </a>
            </div>
            {m.githubName && (
              <p className="text-xs text-muted-foreground truncate">
                {m.githubName}
              </p>
            )}
            {m.githubEmail && (
              <p className="text-xs text-muted-foreground truncate">
                {m.githubEmail}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function UnmatchedSystemList({ users }: { users: SyncUnmatchedSystemUser[] }) {
  if (users.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        All system users have GitHub matches.
      </p>
    );
  }

  return (
    <div className="rounded-md border max-h-80 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.userId}>
              <TableCell className="text-sm font-medium">
                {u.userName}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {u.userEmail}
              </TableCell>
              <TableCell>
                <Badge
                  variant={u.userStatus === "active" ? "default" : "outline"}
                  className="text-xs"
                >
                  {u.userStatus}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
