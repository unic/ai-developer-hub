"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow, format } from "date-fns";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { CopySnippetButton } from "@/components/copy-snippet";
import {
  cancelRequest,
  getRequestMessage,
} from "@/actions/license-requests";
import type {
  ActiveAssignmentSummary,
  LicenseRequestDetail,
  ToolOption,
} from "@/actions/license-requests";
import type { ApprovalTemplateRow } from "@/lib/license-requests/templates";
import { ApprovalDialog } from "./approval-dialog";
import { RecordAssignmentDialog } from "./record-assignment-dialog";
import { RejectionDialog } from "./rejection-dialog";
import { markdownToTeamsHtml } from "@/lib/teams/markdown";

interface Props {
  detail: LicenseRequestDetail;
  tools: ToolOption[];
  activeAssignments: ActiveAssignmentSummary[];
  approvalTemplates: ApprovalTemplateRow[];
  /** Current admin's identity — used to resolve {{approver.*}} in templates. */
  approver: { name: string; firstName: string };
}

const STATUS_LABELS: Record<LicenseRequestDetail["status"], string> = {
  pending_review: "Pending review",
  approved: "Approved",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const STATUS_VARIANT: Record<
  LicenseRequestDetail["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending_review: "default",
  approved: "secondary",
  completed: "outline",
  rejected: "destructive",
  cancelled: "outline",
};

const ROLE_LABELS: Record<NonNullable<LicenseRequestDetail["requesterRole"]>, string> = {
  developer: "Development",
  conception: "Conception",
  business: "Business",
};

const PROFILE_LABELS: Record<
  NonNullable<LicenseRequestDetail["requesterProfile"]>,
  string
> = {
  baseline: "Baseline",
  maxed: "Maxed",
  indie: "Indie",
};

const LICENSE_CODE_TOKEN = /\{\{\s*licenseCode\s*\}\}/g;
const MASKED_CODE = "••••••••••••";

export function RequestDetailClient({
  detail,
  tools,
  activeAssignments,
  approvalTemplates,
  approver,
}: Props) {
  const router = useRouter();
  const status = useInlineStatus();
  const [approveOpen, setApproveOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  const isPending = detail.status === "pending_review";
  // Legacy v1 rows: approved without an assignment — offer "Record assignment".
  const isLegacyApproved =
    detail.status === "approved" && detail.assignmentId === null;

  async function handleCancel() {
    const result = await cancelRequest({ requestId: detail.id });
    if (result.success) {
      setCancelOpen(false);
      router.refresh();
    } else {
      status.error(result.error);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/requests"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Back to requests
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-3xl font-medium tracking-tight text-ink">
            Request REQ-{String(detail.id).padStart(3, "0")}
          </h1>
          <Badge variant={STATUS_VARIANT[detail.status]}>
            {STATUS_LABELS[detail.status]}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Submitted {format(detail.createdAt, "yyyy-MM-dd HH:mm")} ·{" "}
          {formatDistanceToNow(detail.createdAt, { addSuffix: true })}
        </p>
      </div>

      {/* Requester */}
      <Card>
        <CardHeader>
          <CardTitle>Requester</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-y-1 text-sm sm:grid-cols-[160px_1fr] sm:gap-y-2 sm:gap-x-4">
          <span className="text-muted-foreground">Name</span>
          <span>{detail.requesterName}</span>
          <span className="text-muted-foreground">Email</span>
          <span className="break-all">{detail.requesterEmail}</span>
          <span className="text-muted-foreground">Hub user</span>
          <span>
            {detail.requesterUserId !== null ? (
              <Link
                href={`/users/${detail.requesterUserId}`}
                className="text-primary hover:underline"
              >
                Matched (user #{detail.requesterUserId})
              </Link>
            ) : (
              <span className="text-muted-foreground">
                No Hub user yet — created on approval (viewer, no invite)
              </span>
            )}
          </span>
          <span className="text-muted-foreground">Active assignments</span>
          <span>
            {activeAssignments.length === 0 ? (
              <span className="text-muted-foreground">None</span>
            ) : (
              <span className="flex flex-col gap-0.5">
                {activeAssignments.map((a) => (
                  <Link
                    key={a.id}
                    href={`/assignments/${a.id}`}
                    className="text-primary hover:underline"
                  >
                    {a.toolName} · {a.tierName} · since{" "}
                    {format(a.assignedAt, "yyyy-MM-dd")}
                  </Link>
                ))}
              </span>
            )}
          </span>
          {detail.assignmentId !== null && (
            <>
              <span className="text-muted-foreground">Assignment</span>
              <span>
                <Link
                  href={`/assignments/${detail.assignmentId}`}
                  className="text-primary hover:underline"
                >
                  #{detail.assignmentId}
                </Link>
              </span>
            </>
          )}
        </CardContent>
      </Card>

      {/* Request — role/profile/justification + derived tool + form answers */}
      <Card>
        <CardHeader>
          <CardTitle>Request</CardTitle>
          <CardDescription>
            {detail.requesterRole
              ? "Role + profile from the Form; the Hub proposes the tool."
              : "Tool / tier requested + the raw fields submitted to the Form."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(detail.requesterRole || detail.requesterProfile || detail.justification) && (
            <dl className="grid grid-cols-1 gap-y-1 text-sm sm:grid-cols-[160px_1fr] sm:gap-y-2 sm:gap-x-4">
              {detail.requesterRole && (
                <>
                  <dt className="text-muted-foreground">Role</dt>
                  <dd>
                    <Badge variant="secondary">{ROLE_LABELS[detail.requesterRole]}</Badge>
                  </dd>
                </>
              )}
              {detail.requesterProfile && (
                <>
                  <dt className="text-muted-foreground">Profile</dt>
                  <dd>
                    <Badge variant="outline">
                      {PROFILE_LABELS[detail.requesterProfile]}
                    </Badge>
                  </dd>
                </>
              )}
              {detail.justification && (
                <>
                  <dt className="text-muted-foreground">Justification</dt>
                  <dd className="whitespace-pre-wrap">{detail.justification}</dd>
                </>
              )}
            </dl>
          )}

          <DerivedToolBlock detail={detail} />

          <FormPayloadList payload={detail.formPayload} />
        </CardContent>
      </Card>

      {/* Messages — copy-paste log */}
      {(detail.approvalMessageMd ||
        detail.completionMessageMd ||
        detail.decisionNote) && (
        <Card>
          <CardHeader>
            <CardTitle>Messages</CardTitle>
            <CardDescription>
              Copy-paste log — nothing is posted automatically (Teams
              integration postponed).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {detail.approvalMessageMd && (
              <MessageBlock
                kind="approval"
                label="Approval"
                requestId={detail.id}
                actorName={detail.decidedByName}
                at={detail.decidedAt}
                bodyMd={detail.approvalMessageMd}
              />
            )}
            {detail.completionMessageMd && (
              <MessageBlock
                kind="completion"
                label="Completion"
                requestId={detail.id}
                actorName={detail.completedByName}
                at={detail.completedAt}
                bodyMd={detail.completionMessageMd}
              />
            )}
            {detail.status === "rejected" && detail.decisionNote && (
              <MessageBlock
                kind="rejection"
                label="Rejection"
                requestId={detail.id}
                actorName={detail.decidedByName}
                at={detail.decidedAt}
                bodyMd={detail.decisionNote}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Action bar */}
      {(isPending || isLegacyApproved) && (
        <div className="flex flex-col gap-3 rounded-md border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {isPending
              ? "Any admin can act on this request. First-write-wins. Provision access in the vendor's admin UI before approving."
              : "Approved before assignments were created at approval — record the procurement result."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <StatusText status={status.status} />
            {isPending && (
              <>
                <Button variant="ghost" onClick={() => setCancelOpen(true)}>
                  Cancel request
                </Button>
                <Button variant="destructive" onClick={() => setRejectOpen(true)}>
                  Reject
                </Button>
                <Button onClick={() => setApproveOpen(true)}>Approve</Button>
              </>
            )}
            {isLegacyApproved && (
              <Button onClick={() => setRecordOpen(true)}>Record assignment</Button>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this request?</AlertDialogTitle>
            <AlertDialogDescription>
              Any pending approver activity will be discarded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <StatusText status={status.status} />
            <AlertDialogCancel>Keep request</AlertDialogCancel>
            <Button variant="destructive" onClick={handleCancel}>
              Cancel request
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialogs stay mounted regardless of status: the approve action's
          revalidatePath re-renders this page mid-flow, and unmounting on the
          status flip would kill the success/snippet state before the admin
          can copy the message. */}
      <ApprovalDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        detail={detail}
        tools={tools}
        activeAssignments={activeAssignments}
        approvalTemplates={approvalTemplates}
        approver={approver}
        onSuccess={() => router.refresh()}
      />
      <RejectionDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        detail={detail}
        onSuccess={() => router.refresh()}
      />
      <RecordAssignmentDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        detail={detail}
        tools={tools}
        activeAssignments={activeAssignments}
        onSuccess={() => router.refresh()}
      />
    </div>
  );
}

function DerivedToolBlock({ detail }: { detail: LicenseRequestDetail }) {
  const isDecided = detail.status !== "pending_review";
  const needsDecision = detail.requestedToolId === null;
  const derivedLabel = detail.requesterRole
    ? `Derived · ${detail.requesterProfile ?? "?"} → ${detail.requestedToolName ?? "no default"} · tool-mapping`
    : "Requested via the v1 Form contract";

  return (
    <div
      className={
        needsDecision && !isDecided
          ? "rounded-md border border-amber-300/60 bg-amber-500/10 p-3"
          : "rounded-md border bg-muted/40 p-3"
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {needsDecision ? (
          <>
            <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">
              Needs decision
            </Badge>
            {!isDecided && (
              <span className="text-sm text-muted-foreground">
                Pick the tool in the approve dialog
                {detail.requesterProfile === "indie"
                  ? " (indie — Cursor, Claude Console, or other per the AI Tooling Guide)"
                  : ""}
                .
              </span>
            )}
          </>
        ) : (
          <>
            <span className="text-sm font-medium">{detail.requestedToolName}</span>
            {detail.requestedTierName && (
              <Badge variant="outline" className="text-[11px]">
                {detail.requestedTierName}
              </Badge>
            )}
          </>
        )}
      </div>
      <p className="mt-1.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
        {derivedLabel}
        {!isDecided && !needsDecision ? " · override in the approve dialog" : ""}
      </p>
    </div>
  );
}

function FormPayloadList({ payload }: { payload: Record<string, unknown> }) {
  const [showEmpty, setShowEmpty] = useState(false);
  const entries = Object.entries(payload);
  const isEmptyValue = (v: unknown) =>
    v === null || v === undefined || (typeof v === "string" && v.trim() === "");
  const filled = entries.filter(([, v]) => !isEmptyValue(v));
  const emptyCount = entries.length - filled.length;
  const visible = showEmpty ? entries : filled;

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No additional form fields submitted.
      </p>
    );
  }

  return (
    <div>
      <dl className="grid grid-cols-1 gap-y-1 text-sm sm:grid-cols-[minmax(120px,200px)_1fr] sm:gap-y-2 sm:gap-x-4">
        {visible.map(([key, value]) => {
          const stringValue = isEmptyValue(value) ? "—" : stringifyValue(value);
          const isLong = stringValue.length > 120;
          return isLong ? (
            <div key={key} className="col-span-full pt-2 border-t">
              <dt className="text-xs text-muted-foreground uppercase tracking-wide mb-1 break-all">
                {prettifyKey(key)}
              </dt>
              <dd className="whitespace-pre-wrap">{stringValue}</dd>
            </div>
          ) : (
            // Fragment with a key — keys on the inner <dt>/<dd> don't satisfy
            // React's array-element key requirement.
            <Fragment key={key}>
              <dt className="min-w-0 break-all text-muted-foreground">
                {prettifyKey(key)}
              </dt>
              <dd className="min-w-0 break-words font-mono text-xs">{stringValue}</dd>
            </Fragment>
          );
        })}
      </dl>
      {emptyCount > 0 && (
        <button
          type="button"
          onClick={() => setShowEmpty((s) => !s)}
          className="mt-3 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          {showEmpty
            ? "Hide empty answers"
            : `${emptyCount} empty answer${emptyCount === 1 ? "" : "s"} hidden · show all`}
        </button>
      )}
    </div>
  );
}

function MessageBlock({
  kind,
  label,
  requestId,
  actorName,
  at,
  bodyMd,
}: {
  kind: "approval" | "completion" | "rejection";
  label: string;
  requestId: number;
  actorName: string | null;
  at: Date | null;
  bodyMd: string;
}) {
  // Stored approval/completion messages keep {{licenseCode}} unresolved so the
  // audit log never holds the key in plaintext — mask for display, decrypt on
  // demand (Reveal / Copy) via getRequestMessage.
  const containsKey = LICENSE_CODE_TOKEN.test(bodyMd);
  LICENSE_CODE_TOKEN.lastIndex = 0;
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  const displayMd = revealed ?? bodyMd.replace(LICENSE_CODE_TOKEN, MASKED_CODE);
  const html = markdownToTeamsHtml(displayMd);

  async function resolveForCopy(): Promise<string> {
    if (!containsKey || kind === "rejection") return bodyMd;
    if (revealed) return revealed;
    const result = await getRequestMessage({
      requestId,
      kind,
      reveal: true,
    });
    if (!result.success) throw new Error(result.error);
    return result.data.bodyMd;
  }

  async function toggleReveal() {
    if (revealed) {
      setRevealed(null);
      return;
    }
    const result = await getRequestMessage({ requestId, kind: kind === "rejection" ? "approval" : kind, reveal: true });
    if (result.success) {
      setRevealed(result.data.bodyMd);
      setRevealError(null);
    } else {
      setRevealError(result.error);
    }
  }

  return (
    <div className="rounded-md border-l-4 border-l-primary/60 bg-muted/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">{label}</span> · {actorName ?? "(unknown)"}{" "}
          · {at ? format(at, "yyyy-MM-dd HH:mm") : "—"}
        </p>
        <div className="flex items-center gap-1.5">
          {containsKey && kind !== "rejection" && (
            <Button type="button" size="sm" variant="ghost" onClick={toggleReveal}>
              {revealed ? (
                <>
                  <EyeOff className="size-3.5" /> Hide key
                </>
              ) : (
                <>
                  <Eye className="size-3.5" /> Reveal key
                </>
              )}
            </Button>
          )}
          <CopySnippetButton getTextAction={resolveForCopy} />
        </div>
      </div>
      {revealError && (
        <p className="mb-2 text-xs text-destructive">{revealError}</p>
      )}
      <div
        className="min-w-0 break-words text-sm prose-sm dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function prettifyKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
