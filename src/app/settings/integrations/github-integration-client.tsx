"use client";

import { useState, useMemo, useCallback, useTransition } from "react";
import { Github, RefreshCw, Unplug, KeyRound, Users, AlertTriangle, CheckCircle2, XCircle, Clock } from "lucide-react";
import Image from "next/image";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  validateGitHubToken,
  connectGitHubOrg,
  disconnectGitHubOrg,
  updateGitHubToken,
} from "@/actions/github";
import {
  fetchGitHubSyncPreview,
  confirmGitHubSync,
} from "@/actions/github-sync";
import { CopilotSyncSection } from "@/components/copilot/copilot-sync-section";
import { UnmatchedMemberCard } from "@/components/unmatched-member-card";
import { UserSearchCombobox } from "@/components/user-search-combobox";
import { InlineUserForm } from "@/components/inline-user-form";
import { computeMatchSuggestions } from "@/lib/match-suggestions";
import type {
  SyncPreview,
  SyncMatchedMember,
  SyncUnmatchedMember,
  SyncUnmatchedSystemUser,
  PendingResolution,
  ResolutionSummary,
  GitHubConnectionStatus,
  GitHubSyncStatus,
} from "@/types";

interface ConnectionData {
  id: number;
  orgLogin: string;
  orgAvatarUrl: string | null;
  status: GitHubConnectionStatus;
  connectedAt: Date;
  lastSyncAt: Date | null;
}

interface SyncHistoryEvent {
  id: number;
  status: GitHubSyncStatus;
  totalMembers: number | null;
  matchedCount: number | null;
  importedCount: number | null;
  unmatchedCount: number | null;
  manuallyMatchedCount: number | null;
  createdCount: number | null;
  startedAt: Date;
  completedAt: Date | null;
  triggeredByName: string;
}

interface CopilotStatus {
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: "completed" | "partial" | "failed" | null;
  nextScheduledSync: string | null;
  dataRange: { earliest: string; latest: string } | null;
  recordCounts: { metrics: number; billing: number; seats: number };
}

interface Props {
  initialConnection: ConnectionData | null;
  initialSyncHistory: SyncHistoryEvent[];
  copilotStatus: CopilotStatus;
}

type ActiveTab = "matched" | "unmatched" | "system";

export function GitHubIntegrationClient({
  initialConnection,
  initialSyncHistory,
  copilotStatus,
}: Props) {
  const [connection, setConnection] = useState(initialConnection);
  const [isPending, startTransition] = useTransition();

  // Token validation state
  const [token, setToken] = useState("");
  const [orgs, setOrgs] = useState<
    Array<{ login: string; id: number; avatarUrl: string | null; description: string | null }>
  >([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [isValidated, setIsValidated] = useState(false);

  // Update token state
  const [showUpdateToken, setShowUpdateToken] = useState(false);
  const [updateToken, setUpdateTokenValue] = useState("");

  // Sync state
  const [syncPreview, setSyncPreview] = useState<SyncPreview | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("matched");
  const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set());
  const [syncHistory, setSyncHistory] = useState(initialSyncHistory);

  // Manual matching state
  const [pendingResolutions, setPendingResolutions] = useState<Map<string, PendingResolution>>(new Map());
  const [expandedCard, setExpandedCard] = useState<{ login: string; action: "match" | "create" } | null>(null);

  const resolutionSummary = useMemo<ResolutionSummary | null>(() => {
    if (!syncPreview) return null;
    const total = syncPreview.unmatched.length;
    let matched = 0;
    let created = 0;
    let skipped = 0;
    for (const r of pendingResolutions.values()) {
      if (r.type === "match") matched++;
      else if (r.type === "create") created++;
      else if (r.type === "skip") skipped++;
    }
    return { total, matched, created, skipped, unresolved: total - matched - created - skipped };
  }, [syncPreview, pendingResolutions]);

  const handleResolve = useCallback((resolution: PendingResolution) => {
    setPendingResolutions((prev) => {
      const next = new Map(prev);
      next.set(resolution.githubLogin, resolution);
      return next;
    });
    setExpandedCard(null);
  }, []);

  const handleUndoResolution = useCallback((githubLogin: string) => {
    setPendingResolutions((prev) => {
      const next = new Map(prev);
      next.delete(githubLogin);
      return next;
    });
  }, []);

  function handleValidateToken() {
    startTransition(async () => {
      const result = await validateGitHubToken({ token });
      if (result.success) {
        setOrgs(result.data.organizations);
        setIsValidated(true);
        if (result.data.organizations.length === 1) {
          setSelectedOrg(result.data.organizations[0].login);
        }
        toast.success(`Token valid. Found ${result.data.organizations.length} organization(s).`);
      } else {
        toast.error(result.error);
        setIsValidated(false);
        setOrgs([]);
      }
    });
  }

  function handleConnect() {
    const org = orgs.find((o) => o.login === selectedOrg);
    if (!org) return;

    startTransition(async () => {
      const result = await connectGitHubOrg({
        token,
        orgLogin: org.login,
        orgId: org.id,
      });
      if (result.success) {
        setConnection({
          id: result.data.connectionId,
          orgLogin: org.login,
          orgAvatarUrl: org.avatarUrl,
          status: "active",
          connectedAt: new Date(),
          lastSyncAt: null,
        });
        setToken("");
        setIsValidated(false);
        setOrgs([]);
        toast.success(`Connected to ${org.login}`);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDisconnect() {
    startTransition(async () => {
      const result = await disconnectGitHubOrg();
      if (result.success) {
        setConnection(null);
        setSyncPreview(null);
        toast.success("Disconnected. Enriched user data has been retained.");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleUpdateToken() {
    startTransition(async () => {
      const result = await updateGitHubToken({ token: updateToken });
      if (result.success) {
        setShowUpdateToken(false);
        setUpdateTokenValue("");
        toast.success("Token updated successfully");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleStartSync() {
    setIsSyncing(true);
    startTransition(async () => {
      const result = await fetchGitHubSyncPreview();
      setIsSyncing(false);
      if (result.success) {
        setSyncPreview(result.data);
        setActiveTab("matched");
        setSelectedImports(new Set());
        setPendingResolutions(new Map());
        setExpandedCard(null);
        toast.success(
          `Fetched ${result.data.totalMembers} members. ${result.data.matched.length} matched.`
        );
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleConfirmSync() {
    if (!syncPreview) return;

    // Extract manual matches and new users from pending resolutions
    const manualMatches: Array<{ githubLogin: string; userId: number }> = [];
    const newUsers: Array<{ githubLogin: string; name: string; email: string }> = [];

    for (const r of pendingResolutions.values()) {
      if (r.type === "match") {
        manualMatches.push({ githubLogin: r.githubLogin, userId: r.userId });
      } else if (r.type === "create") {
        newUsers.push({ githubLogin: r.githubLogin, name: r.name, email: r.email });
      }
    }

    startTransition(async () => {
      const result = await confirmGitHubSync({
        importGitHubLogins: Array.from(selectedImports),
        manualMatches,
        newUsers,
      });
      if (result.success) {
        const d = result.data;
        const parts = [`${d.enrichedCount} enriched`];
        if (d.manuallyMatchedCount > 0) parts.push(`${d.manuallyMatchedCount} manually matched`);
        if (d.createdCount > 0) parts.push(`${d.createdCount} created`);
        if (d.importedCount > 0) parts.push(`${d.importedCount} imported`);
        toast.success(`Sync complete: ${parts.join(", ")}`);
        setSyncPreview(null);
        setPendingResolutions(new Map());
        setConnection((prev) =>
          prev ? { ...prev, lastSyncAt: new Date() } : prev
        );
      } else {
        toast.error(result.error);
      }
    });
  }


  // --- Render ---

  if (!connection) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="size-5" />
            GitHub Organization
          </CardTitle>
          <CardDescription>
            Connect your GitHub organization to enrich user profiles with GitHub
            data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="github-token">Personal Access Token (Classic)</Label>
            <Input
              id="github-token"
              type="password"
              placeholder="ghp_..."
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setIsValidated(false);
                setOrgs([]);
              }}
              aria-describedby="token-help"
            />
            <p id="token-help" className="text-xs text-muted-foreground">
              Requires <code>read:org</code> and <code>read:user</code> scopes.
            </p>
          </div>

          <Button
            onClick={handleValidateToken}
            disabled={!token || isPending}
            variant="outline"
          >
            {isPending ? "Validating..." : "Validate Token"}
          </Button>

          {isValidated && orgs.length > 0 && (
            <div className="space-y-3 pt-2 border-t">
              <div className="space-y-2">
                <Label htmlFor="org-select">Select Organization</Label>
                <Select value={selectedOrg} onValueChange={setSelectedOrg}>
                  <SelectTrigger id="org-select" aria-label="Select GitHub organization">
                    <SelectValue placeholder="Choose an organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {orgs.map((org) => (
                      <SelectItem key={org.login} value={org.login}>
                        {org.login}
                        {org.description ? ` — ${org.description}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleConnect}
                disabled={!selectedOrg || isPending}
              >
                {isPending ? "Connecting..." : "Connect Organization"}
              </Button>
            </div>
          )}

          {isValidated && orgs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No organizations found for this token.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Connected state
  return (
    <div className="space-y-6">
      {/* Connection Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Github className="size-5" />
              {connection.orgLogin}
            </CardTitle>
            <Badge variant="default">Connected</Badge>
          </div>
          <CardDescription>
            Connected {formatDate(connection.connectedAt)}
            {connection.lastSyncAt && (
              <>
                {" "}
                · Last synced{" "}
                {formatDate(connection.lastSyncAt)}
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={handleStartSync}
              disabled={isPending || isSyncing}
              size="sm"
            >
              <RefreshCw
                className={`size-4 mr-2 ${isSyncing ? "animate-spin" : ""}`}
              />
              {isSyncing ? "Fetching members..." : "Sync Members"}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowUpdateToken(!showUpdateToken)}
            >
              <KeyRound className="size-4 mr-2" />
              Update Token
            </Button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isPending}>
                  <Unplug className="size-4 mr-2" />
                  Disconnect
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Disconnect GitHub Organization?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove the connection credentials. Previously
                    enriched user data will be retained.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDisconnect}>
                    Disconnect
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {/* Update Token Form */}
          {showUpdateToken && (
            <div className="mt-4 p-4 border rounded-lg space-y-3">
              <Label htmlFor="update-token">New Personal Access Token</Label>
              <Input
                id="update-token"
                type="password"
                placeholder="ghp_..."
                value={updateToken}
                onChange={(e) => setUpdateTokenValue(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleUpdateToken}
                  disabled={!updateToken || isPending}
                >
                  {isPending ? "Updating..." : "Save Token"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowUpdateToken(false);
                    setUpdateTokenValue("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync Preview */}
      {syncPreview && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="size-5" />
              Sync Preview
            </CardTitle>
            <CardDescription>
              {syncPreview.totalMembers} GitHub members found ·{" "}
              {syncPreview.matched.length} matched ·{" "}
              {syncPreview.unmatched.length} unmatched ·{" "}
              {syncPreview.conflicts.length} conflicts
              {syncPreview.rateLimitRemaining < 500 && (
                <span className="text-amber-600 ml-2">
                  · Rate limit: {syncPreview.rateLimitRemaining} remaining
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Resolution Progress (T017) */}
            {resolutionSummary && resolutionSummary.total > 0 && (
              <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg text-sm" role="status" aria-live="polite">
                <span className="font-medium">
                  {resolutionSummary.total - resolutionSummary.unresolved} of{" "}
                  {resolutionSummary.total} resolved
                </span>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  {resolutionSummary.matched > 0 && (
                    <span>Matched: {resolutionSummary.matched}</span>
                  )}
                  {resolutionSummary.created > 0 && (
                    <span>Created: {resolutionSummary.created}</span>
                  )}
                  {resolutionSummary.skipped > 0 && (
                    <span>Skipped: {resolutionSummary.skipped}</span>
                  )}
                  {resolutionSummary.unresolved > 0 && (
                    <span className="text-amber-600">
                      Unresolved: {resolutionSummary.unresolved}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Tabs */}
            <div className="flex gap-1 border-b" role="tablist" aria-label="Sync preview tabs">
              {[
                { id: "matched" as const, label: `Matched (${syncPreview.matched.length})` },
                { id: "unmatched" as const, label: `Unmatched GitHub (${syncPreview.unmatched.length})` },
                { id: "system" as const, label: `Unmatched System (${syncPreview.unmatchedSystemUsers.length})` },
              ].map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  aria-controls={`panel-${tab.id}`}
                  className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    activeTab === tab.id
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Panels */}
            <div role="tabpanel" id={`panel-${activeTab}`} aria-label={activeTab}>
              {activeTab === "matched" && (
                <MatchedTable members={syncPreview.matched} />
              )}
              {activeTab === "unmatched" && (
                <UnmatchedMembersList
                  members={syncPreview.unmatched}
                  unmatchedSystemUsers={syncPreview.unmatchedSystemUsers}
                  pendingResolutions={pendingResolutions}
                  expandedCard={expandedCard}
                  onResolve={handleResolve}
                  onUndo={handleUndoResolution}
                  onExpandCard={setExpandedCard}
                  onCollapseCard={() => setExpandedCard(null)}
                />
              )}
              {activeTab === "system" && (
                <SystemUsersTable users={syncPreview.unmatchedSystemUsers} />
              )}
            </div>

            {/* Conflicts Warning */}
            {syncPreview.conflicts.length > 0 && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 font-medium text-sm mb-1">
                  <AlertTriangle className="size-4" />
                  {syncPreview.conflicts.length} match conflict(s) detected
                </div>
                {syncPreview.conflicts.map((c, i) => (
                  <p key={i} className="text-xs text-amber-700 dark:text-amber-300 ml-6">
                    {c.detail}
                  </p>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2 border-t">
              {resolutionSummary && resolutionSummary.unresolved > 0 ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button disabled={isPending}>
                      {isPending ? "Syncing..." : "Confirm Sync"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Unresolved Members</AlertDialogTitle>
                      <AlertDialogDescription>
                        {resolutionSummary.unresolved} member(s) remain unresolved. They will stay
                        unmatched. Continue?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleConfirmSync}>
                        Continue
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <Button onClick={handleConfirmSync} disabled={isPending}>
                  {isPending ? "Syncing..." : "Confirm Sync"}
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setSyncPreview(null);
                  setPendingResolutions(new Map());
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sync History */}
      {syncHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Sync History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Auto</TableHead>
                  <TableHead>Imported</TableHead>
                  <TableHead>Manual</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Unmatched</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {syncHistory.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="text-sm">
                      {formatDate(event.startedAt)}
                    </TableCell>
                    <TableCell>
                      <SyncStatusBadge status={event.status} />
                    </TableCell>
                    <TableCell>{event.totalMembers ?? "—"}</TableCell>
                    <TableCell>{event.matchedCount ?? "—"}</TableCell>
                    <TableCell>{event.importedCount ?? "—"}</TableCell>
                    <TableCell>{event.manuallyMatchedCount ?? "—"}</TableCell>
                    <TableCell>{event.createdCount ?? "—"}</TableCell>
                    <TableCell>{event.unmatchedCount ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {event.triggeredByName}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Copilot Sync Section */}
      <CopilotSyncSection
        initialStatus={copilotStatus}
      />
    </div>
  );
}

// --- Sub-components ---

function MatchedTable({ members }: { members: SyncMatchedMember[] }) {
  if (members.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No matched members.</p>;
  }

  return (
    <div className="max-h-80 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>GitHub</TableHead>
            <TableHead>System User</TableHead>
            <TableHead>Match</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.githubLogin}>
              <TableCell className="font-medium">
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
                  {m.githubLogin}
                </div>
              </TableCell>
              <TableCell>
                {m.matchedUserName}
                <span className="text-xs text-muted-foreground ml-1">
                  ({m.matchedUserEmail})
                </span>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="text-xs">
                  {m.matchType}
                </Badge>
              </TableCell>
              <TableCell>
                {m.hasConflict ? (
                  <Badge variant="destructive" className="text-xs">
                    <AlertTriangle className="size-3 mr-1" />
                    Conflict
                  </Badge>
                ) : (
                  <CheckCircle2 className="size-4 text-green-600" />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function UnmatchedMembersList({
  members,
  unmatchedSystemUsers,
  pendingResolutions,
  expandedCard,
  onResolve,
  onUndo,
  onExpandCard,
  onCollapseCard,
}: {
  members: SyncUnmatchedMember[];
  unmatchedSystemUsers: SyncUnmatchedSystemUser[];
  pendingResolutions: Map<string, PendingResolution>;
  expandedCard: { login: string; action: "match" | "create" } | null;
  onResolve: (resolution: PendingResolution) => void;
  onUndo: (githubLogin: string) => void;
  onExpandCard: (card: { login: string; action: "match" | "create" }) => void;
  onCollapseCard: () => void;
}) {
  const [overwriteConfirm, setOverwriteConfirm] = useState<{
    githubLogin: string;
    user: { id: number; name: string; githubUsername: string };
  } | null>(null);

  // Memoize suggestions for all unmatched members to avoid O(unmatched × systemUsers) per render (#8)
  const suggestionsMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeMatchSuggestions>>();
    for (const member of members) {
      map.set(member.githubLogin, computeMatchSuggestions(member, unmatchedSystemUsers));
    }
    return map;
  }, [members, unmatchedSystemUsers]);

  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        All GitHub members matched to system users.
      </p>
    );
  }

  // Collect already-matched user IDs to exclude from search
  const excludeUserIds = Array.from(pendingResolutions.values())
    .filter((r): r is PendingResolution & { type: "match" } => r.type === "match")
    .map((r) => r.userId);

  function handleMatchSelect(
    githubLogin: string,
    user: { id: number; name: string; email: string; status: "active" | "inactive"; githubUsername: string | null }
  ) {
    // FR-009: Warn if user already has a different GitHub username
    if (user.githubUsername && user.githubUsername.toLowerCase() !== githubLogin.toLowerCase()) {
      setOverwriteConfirm({
        githubLogin,
        user: { id: user.id, name: user.name, githubUsername: user.githubUsername },
      });
      return;
    }
    onResolve({
      type: "match",
      githubLogin,
      userId: user.id,
      userName: user.name,
    });
  }

  return (
    <>
      <div className="max-h-[32rem] overflow-auto space-y-3 pr-1">
        {members.map((member) => {
          const suggestions = suggestionsMap.get(member.githubLogin) ?? [];
          const resolution = pendingResolutions.get(member.githubLogin);
          const isMatchExpanded = expandedCard?.login === member.githubLogin && expandedCard.action === "match";
          const isCreateExpanded = expandedCard?.login === member.githubLogin && expandedCard.action === "create";

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
              onExpandMatch={() => onExpandCard({ login: member.githubLogin, action: "match" })}
              onExpandCreate={() => onExpandCard({ login: member.githubLogin, action: "create" })}
              onCollapse={onCollapseCard}
              matchActionSlot={
                <UserSearchCombobox
                  onSelect={(user) => handleMatchSelect(member.githubLogin, user)}
                  excludeUserIds={excludeUserIds}
                  onCancel={onCollapseCard}
                />
              }
              createActionSlot={
                <InlineUserForm
                  defaultName={member.githubName || member.githubLogin}
                  defaultEmail={member.githubEmail || ""}
                  githubLogin={member.githubLogin}
                  onSubmit={(data) =>
                    onResolve({
                      type: "create",
                      githubLogin: data.githubLogin,
                      name: data.name,
                      email: data.email,
                    })
                  }
                  onCancel={onCollapseCard}
                />
              }
            />
          );
        })}
      </div>

      {/* FR-009: Overwrite confirmation dialog */}
      <AlertDialog
        open={!!overwriteConfirm}
        onOpenChange={(open) => !open && setOverwriteConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace GitHub Link?</AlertDialogTitle>
            <AlertDialogDescription>
              {overwriteConfirm && (
                <>
                  {overwriteConfirm.user.name} is already linked to GitHub user{" "}
                  <strong>{overwriteConfirm.user.githubUsername}</strong>. Replace with{" "}
                  <strong>{overwriteConfirm.githubLogin}</strong>?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (overwriteConfirm) {
                  onResolve({
                    type: "match",
                    githubLogin: overwriteConfirm.githubLogin,
                    userId: overwriteConfirm.user.id,
                    userName: overwriteConfirm.user.name,
                  });
                  setOverwriteConfirm(null);
                }
              }}
            >
              Replace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SystemUsersTable({
  users,
}: {
  users: SyncUnmatchedSystemUser[];
}) {
  if (users.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        All system users matched to GitHub members.
      </p>
    );
  }

  return (
    <div className="max-h-80 overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>GitHub Username</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.userId}>
              <TableCell className="font-medium">{u.userName}</TableCell>
              <TableCell className="text-sm">{u.userEmail}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {u.githubUsername || "Not set"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SyncStatusBadge({ status }: { status: GitHubSyncStatus }) {
  switch (status) {
    case "completed":
      return (
        <Badge variant="default" className="text-xs">
          <CheckCircle2 className="size-3 mr-1" />
          Completed
        </Badge>
      );
    case "in_progress":
      return (
        <Badge variant="secondary" className="text-xs">
          <Clock className="size-3 mr-1" />
          In Progress
        </Badge>
      );
    case "partial":
      return (
        <Badge variant="outline" className="text-xs text-amber-600">
          <AlertTriangle className="size-3 mr-1" />
          Partial
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="text-xs">
          <XCircle className="size-3 mr-1" />
          Failed
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
