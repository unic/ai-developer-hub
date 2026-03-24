"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Download,
  UserCheck,
  UserPlus,
  SkipForward,
} from "lucide-react";
import { toast } from "sonner";
import {
  fetchGitHubSyncPreview,
  confirmGitHubSync,
} from "@/actions/github-sync";
import { computeMatchSuggestions } from "@/lib/match-suggestions";
import { UnmatchedMemberCard } from "@/components/unmatched-member-card";
import { UserSearchCombobox } from "@/components/user-search-combobox";
import { InlineUserForm } from "@/components/inline-user-form";
import type {
  SyncPreview,
  SyncMatchedMember,
  SyncUnmatchedMember,
  SyncUnmatchedSystemUser,
  PendingResolution,
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

  // Resolution state: keyed by githubLogin
  const [resolutions, setResolutions] = useState<
    Map<string, PendingResolution>
  >(new Map());

  // Track which card has an expanded action panel
  const [expandedCard, setExpandedCard] = useState<{
    githubLogin: string;
    action: "match" | "create";
  } | null>(null);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPreview(null);
    setResolutions(new Map());
    setExpandedCard(null);
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
      setPreview(null);
      setError(null);
      setResolutions(new Map());
      setExpandedCard(null);
    }
  }, [open, loadPreview]);

  function handleResolve(resolution: PendingResolution) {
    setResolutions((prev) => {
      const next = new Map(prev);
      next.set(resolution.githubLogin, resolution);
      return next;
    });
    setExpandedCard(null);
  }

  function handleUndo(githubLogin: string) {
    setResolutions((prev) => {
      const next = new Map(prev);
      next.delete(githubLogin);
      return next;
    });
  }

  // User IDs to exclude from manual match search
  const excludeUserIds = useMemo(() => {
    const ids: number[] = [];
    if (preview) {
      for (const m of preview.matched) {
        ids.push(m.matchedUserId);
      }
    }
    for (const r of resolutions.values()) {
      if (r.type === "match") {
        ids.push(r.userId);
      }
    }
    return ids;
  }, [preview, resolutions]);

  // Resolution summary counts
  const summary = useMemo(() => {
    if (!preview) return null;
    const total = preview.unmatched.length;
    let imported = 0;
    let matched = 0;
    let created = 0;
    let skipped = 0;

    for (const r of resolutions.values()) {
      switch (r.type) {
        case "import":
          imported++;
          break;
        case "match":
          matched++;
          break;
        case "create":
          created++;
          break;
        case "skip":
          skipped++;
          break;
      }
    }

    return {
      total,
      imported,
      matched,
      created,
      skipped,
      unresolved: total - imported - matched - created - skipped,
    };
  }, [preview, resolutions]);

  async function handleConfirm() {
    if (!preview) return;

    const importGitHubLogins: string[] = [];
    const manualMatches: Array<{ githubLogin: string; userId: number }> = [];
    const newUsers: Array<{
      githubLogin: string;
      name: string;
      email: string;
    }> = [];

    for (const r of resolutions.values()) {
      switch (r.type) {
        case "import":
          importGitHubLogins.push(r.githubLogin);
          break;
        case "match":
          manualMatches.push({ githubLogin: r.githubLogin, userId: r.userId });
          break;
        case "create":
          newUsers.push({
            githubLogin: r.githubLogin,
            name: r.name,
            email: r.email,
          });
          break;
        // skip: nothing to send
      }
    }

    setConfirming(true);
    try {
      const result = await confirmGitHubSync({
        importGitHubLogins,
        manualMatches,
        newUsers,
      });
      if (result.success) {
        const d = result.data;
        const parts: string[] = [];
        if (d.enrichedCount > 0) parts.push(`${d.enrichedCount} enriched`);
        if (d.importedCount > 0) parts.push(`${d.importedCount} imported`);
        if (d.manuallyMatchedCount > 0)
          parts.push(`${d.manuallyMatchedCount} matched`);
        if (d.createdCount > 0) parts.push(`${d.createdCount} created`);
        if (d.skippedCount > 0) parts.push(`${d.skippedCount} skipped`);
        toast.success(`Sync complete: ${parts.join(", ")}`);
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
                  <UnmatchedGitHubResolutionList
                    members={preview.unmatched}
                    unmatchedSystemUsers={preview.unmatchedSystemUsers}
                    resolutions={resolutions}
                    expandedCard={expandedCard}
                    excludeUserIds={excludeUserIds}
                    onResolve={handleResolve}
                    onUndo={handleUndo}
                    onExpandCard={setExpandedCard}
                    onCollapse={() => setExpandedCard(null)}
                  />
                </TabsContent>

                <TabsContent value="unmatched-system" className="mt-4">
                  <UnmatchedSystemList users={preview.unmatchedSystemUsers} />
                </TabsContent>
              </Tabs>

              {/* Resolution summary */}
              {preview.unmatched.length > 0 && summary && (
                <ResolutionSummaryPanel summary={summary} />
              )}

              {/* Confirm / Cancel */}
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

/* ---------- Summary Card ---------- */

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

/* ---------- Resolution Summary ---------- */

function ResolutionSummaryPanel({
  summary,
}: {
  summary: {
    total: number;
    imported: number;
    matched: number;
    created: number;
    skipped: number;
    unresolved: number;
  };
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <p className="text-sm font-medium">Resolution Summary</p>
      <div className="grid grid-cols-5 gap-2 text-center">
        <div>
          <p className="text-lg font-bold tabular-nums">{summary.imported}</p>
          <p className="text-[10px] text-muted-foreground">
            <Download className="size-3 inline mr-0.5" />
            Import
          </p>
        </div>
        <div>
          <p className="text-lg font-bold tabular-nums">{summary.matched}</p>
          <p className="text-[10px] text-muted-foreground">
            <UserCheck className="size-3 inline mr-0.5" />
            Matched
          </p>
        </div>
        <div>
          <p className="text-lg font-bold tabular-nums">{summary.created}</p>
          <p className="text-[10px] text-muted-foreground">
            <UserPlus className="size-3 inline mr-0.5" />
            New User
          </p>
        </div>
        <div>
          <p className="text-lg font-bold tabular-nums">{summary.skipped}</p>
          <p className="text-[10px] text-muted-foreground">
            <SkipForward className="size-3 inline mr-0.5" />
            Skipped
          </p>
        </div>
        <div>
          <p className="text-lg font-bold tabular-nums">
            {summary.unresolved}
          </p>
          <p className="text-[10px] text-muted-foreground">Unresolved</p>
        </div>
      </div>
    </div>
  );
}

/* ---------- Matched Table ---------- */

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

/* ---------- Unmatched GitHub Members with Resolution Controls ---------- */

function UnmatchedGitHubResolutionList({
  members,
  unmatchedSystemUsers,
  resolutions,
  expandedCard,
  excludeUserIds,
  onResolve,
  onUndo,
  onExpandCard,
  onCollapse,
}: {
  members: SyncUnmatchedMember[];
  unmatchedSystemUsers: SyncUnmatchedSystemUser[];
  resolutions: Map<string, PendingResolution>;
  expandedCard: {
    githubLogin: string;
    action: "match" | "create";
  } | null;
  excludeUserIds: number[];
  onResolve: (resolution: PendingResolution) => void;
  onUndo: (githubLogin: string) => void;
  onExpandCard: (card: {
    githubLogin: string;
    action: "match" | "create";
  }) => void;
  onCollapse: () => void;
}) {
  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        All GitHub members are matched.
      </p>
    );
  }

  return (
    <div className="space-y-3 max-h-[28rem] overflow-y-auto pr-1">
      {members.map((member) => {
        const resolution = resolutions.get(member.githubLogin);
        const isMatchExpanded =
          expandedCard?.githubLogin === member.githubLogin &&
          expandedCard.action === "match";
        const isCreateExpanded =
          expandedCard?.githubLogin === member.githubLogin &&
          expandedCard.action === "create";

        const suggestions = computeMatchSuggestions(member, unmatchedSystemUsers);

        return (
          <UnmatchedMemberCard
            key={member.githubLogin}
            member={member}
            suggestions={suggestions}
            resolution={resolution}
            onResolve={onResolve}
            onUndo={onUndo}
            isMatchExpanded={isMatchExpanded}
            isCreateExpanded={isCreateExpanded}
            onExpandMatch={() =>
              onExpandCard({
                githubLogin: member.githubLogin,
                action: "match",
              })
            }
            onExpandCreate={() =>
              onExpandCard({
                githubLogin: member.githubLogin,
                action: "create",
              })
            }
            onCollapse={onCollapse}
            matchActionSlot={
              <UserSearchCombobox
                excludeUserIds={excludeUserIds}
                onSelect={(user) =>
                  onResolve({
                    type: "match",
                    githubLogin: member.githubLogin,
                    userId: user.id,
                    userName: user.name,
                  })
                }
                onCancel={onCollapse}
              />
            }
            createActionSlot={
              <InlineUserForm
                githubLogin={member.githubLogin}
                defaultName={member.githubName ?? ""}
                defaultEmail={member.githubEmail ?? ""}
                onSubmit={(data) =>
                  onResolve({
                    type: "create",
                    githubLogin: data.githubLogin,
                    name: data.name,
                    email: data.email,
                  })
                }
                onCancel={onCollapse}
              />
            }
          />
        );
      })}
    </div>
  );
}

/* ---------- Unmatched System Users (informational) ---------- */

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
