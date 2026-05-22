"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDistanceToNow, format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { cancelRequest } from "@/actions/license-requests";
import type { LicenseRequestDetail } from "@/actions/license-requests";
import { ApprovalDialog } from "./approval-dialog";
import { CompletionDialog } from "./completion-dialog";
import { RejectionDialog } from "./rejection-dialog";
import { markdownToTeamsHtml } from "@/lib/teams/markdown";

interface Props {
  detail: LicenseRequestDetail;
  tiers: { id: number; name: string; monthlyCostCents: number }[];
  approvalTemplate: string | null;
  completionTemplate: string | null;
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

export function RequestDetailClient({
  detail,
  tiers,
  approvalTemplate,
  completionTemplate,
  approver,
}: Props) {
  const router = useRouter();
  const [approveOpen, setApproveOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const isPending = detail.status === "pending_review";
  const isApproved = detail.status === "approved";
  const canCancel = isPending || isApproved;

  async function handleCancel() {
    if (!confirm("Cancel this request? Any pending approver activity will be discarded.")) return;
    const result = await cancelRequest({ requestId: detail.id });
    if (result.success) {
      toast.success("Request cancelled");
      router.refresh();
    } else {
      toast.error(result.error);
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
          <h1 className="text-3xl font-bold">
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
        <CardContent className="grid grid-cols-[160px_1fr] gap-y-2 gap-x-4 text-sm">
          <span className="text-muted-foreground">Name</span>
          <span>{detail.requesterName}</span>
          <span className="text-muted-foreground">Email</span>
          <span>{detail.requesterEmail}</span>
          <span className="text-muted-foreground">Hub user</span>
          <span>
            {detail.requesterUserId !== null ? (
              <Link href={`/users/${detail.requesterUserId}`} className="text-primary hover:underline">
                Matched (user #{detail.requesterUserId})
              </Link>
            ) : (
              <span className="text-muted-foreground italic">
                Not matched — create a Hub user before completing this request
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

      {/* Request / form payload */}
      <Card>
        <CardHeader>
          <CardTitle>Request</CardTitle>
          <CardDescription>
            Tool / tier requested + the raw fields submitted to the Form.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormPayloadList
            toolName={detail.requestedToolName}
            tierName={detail.requestedTierName}
            payload={detail.formPayload}
          />
        </CardContent>
      </Card>

      {/* Sent messages (audit) */}
      {(detail.approvalMessageMd || detail.completionMessageMd || detail.decisionNote) && (
        <Card>
          <CardHeader>
            <CardTitle>Sent messages</CardTitle>
            <CardDescription>
              Audit log of what the Hub posted to the Teams channel + group chat.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {detail.approvalMessageMd && (
              <MessageBlock
                kind="Approval"
                actorName={detail.decidedByName}
                at={detail.decidedAt}
                bodyMd={detail.approvalMessageMd}
              />
            )}
            {detail.completionMessageMd && (
              <MessageBlock
                kind="Completion"
                actorName={detail.completedByName}
                at={detail.completedAt}
                bodyMd={detail.completionMessageMd}
              />
            )}
            {detail.status === "rejected" && detail.decisionNote && (
              <MessageBlock
                kind="Rejection"
                actorName={detail.decidedByName}
                at={detail.decidedAt}
                bodyMd={detail.decisionNote}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Action bar */}
      {(isPending || isApproved || canCancel) && (
        <div className="flex justify-between items-center rounded-md border bg-muted/40 p-4">
          <p className="text-sm text-muted-foreground">
            Any admin can act on this request. First-write-wins.
          </p>
          <div className="flex gap-2">
            {canCancel && (
              <Button variant="ghost" onClick={handleCancel}>
                Cancel request
              </Button>
            )}
            {isPending && (
              <>
                <Button variant="destructive" onClick={() => setRejectOpen(true)}>
                  Reject
                </Button>
                <Button onClick={() => setApproveOpen(true)}>Approve</Button>
              </>
            )}
            {isApproved && (
              <Button onClick={() => setCompleteOpen(true)}>Complete</Button>
            )}
          </div>
        </div>
      )}

      {isPending && (
        <>
          <ApprovalDialog
            open={approveOpen}
            onOpenChange={setApproveOpen}
            detail={detail}
            template={approvalTemplate}
            approver={approver}
            onSuccess={() => router.refresh()}
          />
          <RejectionDialog
            open={rejectOpen}
            onOpenChange={setRejectOpen}
            detail={detail}
            onSuccess={() => router.refresh()}
          />
        </>
      )}
      {isApproved && (
        <CompletionDialog
          open={completeOpen}
          onOpenChange={setCompleteOpen}
          detail={detail}
          tiers={tiers}
          template={completionTemplate}
          approver={approver}
          onSuccess={() => router.refresh()}
        />
      )}
    </div>
  );
}

function FormPayloadList({
  toolName,
  tierName,
  payload,
}: {
  toolName: string;
  tierName: string | null;
  payload: Record<string, unknown>;
}) {
  const entries = Object.entries(payload);
  return (
    <dl className="grid grid-cols-[160px_1fr] gap-y-2 gap-x-4 text-sm">
      <dt className="text-muted-foreground">Tool</dt>
      <dd>{toolName}</dd>
      {tierName && (
        <>
          <dt className="text-muted-foreground">Tier</dt>
          <dd>{tierName}</dd>
        </>
      )}
      {entries.length === 0 && (
        <>
          <dt className="text-muted-foreground italic col-span-2">
            No additional form fields submitted.
          </dt>
        </>
      )}
      {entries.map(([key, value]) => {
        const stringValue = stringifyValue(value);
        const isLong = stringValue.length > 120;
        return isLong ? (
          <div key={key} className="col-span-2 pt-2 border-t">
            <dt className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
              {prettifyKey(key)}
            </dt>
            <dd className="whitespace-pre-wrap">{stringValue}</dd>
          </div>
        ) : (
          // Fragment with a key — keys on the inner <dt>/<dd> don't satisfy
          // React's array-element key requirement.
          <Fragment key={key}>
            <dt className="text-muted-foreground">{prettifyKey(key)}</dt>
            <dd className="font-mono text-xs">{stringValue}</dd>
          </Fragment>
        );
      })}
    </dl>
  );
}

function MessageBlock({
  kind,
  actorName,
  at,
  bodyMd,
}: {
  kind: string;
  actorName: string | null;
  at: Date | null;
  bodyMd: string;
}) {
  const html = markdownToTeamsHtml(bodyMd);
  return (
    <div className="rounded-md border-l-4 border-l-primary/60 bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground mb-2">
        <span className="font-medium">{kind}</span> · {actorName ?? "(unknown)"} ·{" "}
        {at ? format(at, "yyyy-MM-dd HH:mm") : "—"}
      </p>
      <div
        className="text-sm prose-sm dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function prettifyKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
