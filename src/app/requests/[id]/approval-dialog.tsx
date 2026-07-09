"use client";

// 032-v2 approval dialog — approving creates the assignment (provision-first:
// the admin has already done the vendor-side work). Two steps: (1) assignment
// details incl. API key for requires_api_key tools, (2) the message, which
// ends as a copy-paste snippet — nothing is posted to Teams.

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CopySnippetButton } from "@/components/copy-snippet";
import { approveRequest } from "@/actions/license-requests";
import type { LicenseRequestDetail, ToolOption } from "@/actions/license-requests";
import type { ApprovalTemplateRow } from "@/lib/license-requests/templates";
import {
  renderTemplate,
  type TemplateContext,
} from "@/lib/license-requests/render-template";
import { markdownToTeamsHtml } from "@/lib/teams/markdown";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: LicenseRequestDetail;
  tools: ToolOption[];
  approvalTemplates: ApprovalTemplateRow[];
  approver: { name: string; firstName: string };
  onSuccess: () => void;
}

type Step = 1 | 2 | "done";

const LICENSE_CODE_TOKEN = /\{\{\s*licenseCode\s*\}\}/g;

function resolveTemplate(
  templates: ApprovalTemplateRow[],
  toolId: number,
  tierId: number | null,
): string | null {
  const override =
    tierId !== null
      ? templates.find((t) => t.toolId === toolId && t.tierId === tierId)
      : undefined;
  if (override) return override.bodyMd;
  return templates.find((t) => t.toolId === toolId && t.tierId === null)?.bodyMd ?? null;
}

export function ApprovalDialog({
  open,
  onOpenChange,
  detail,
  tools,
  approvalTemplates,
  approver,
  onSuccess,
}: Props) {
  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const [step, setStep] = useState<Step>(1);
  const [toolId, setToolId] = useState<number | null>(detail.requestedToolId);
  const [tierId, setTierId] = useState<number | null>(detail.requestedTierId);
  const [licenseCode, setLicenseCode] = useState("");
  const [assignedAt, setAssignedAt] = useState(today);
  const [bodyMd, setBodyMd] = useState("");
  const [assignmentId, setAssignmentId] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const status = useInlineStatus();

  useEffect(() => {
    if (open) {
      setStep(1);
      setToolId(detail.requestedToolId);
      setTierId(detail.requestedTierId);
      setLicenseCode("");
      setAssignedAt(today);
      setBodyMd("");
      setAssignmentId(null);
    }
  }, [open, detail.requestedToolId, detail.requestedTierId, today]);

  const selectedTool = tools.find((t) => t.id === toolId) ?? null;
  const selectedTier = selectedTool?.tiers.find((t) => t.id === tierId) ?? null;
  const needsKey = selectedTool?.requiresApiKey ?? false;
  const willCreateUser = detail.requesterUserId === null;

  function handleToolChange(value: string) {
    const id = Number.parseInt(value, 10);
    setToolId(id);
    const tool = tools.find((t) => t.id === id);
    // Keep the tier when it belongs to the new tool; else default to its
    // first tier (most tools have exactly one).
    setTierId(
      tool?.tiers.some((t) => t.id === tierId)
        ? tierId
        : (tool?.tiers[0]?.id ?? null),
    );
  }

  function handleAdvance() {
    if (!selectedTool || !selectedTier) {
      status.error("Select a tool and tier");
      return;
    }
    if (needsKey && licenseCode.trim().length === 0) {
      status.error(`${selectedTool.name} needs the API key you provisioned`);
      return;
    }
    // Render the template with everything EXCEPT licenseCode bound — the
    // token stays literal so the stored message never contains the key
    // (see getRequestMessage in actions/license-requests.ts).
    const template = resolveTemplate(approvalTemplates, selectedTool.id, selectedTier.id);
    const ctx = buildContext(detail, selectedTool.name, selectedTier.name, approver);
    setBodyMd(template ? renderTemplate(template, ctx).rendered : "");
    setStep(2);
  }

  function handleApprove() {
    if (!selectedTool || !selectedTier) return;
    startTransition(async () => {
      const result = await approveRequest({
        requestId: detail.id,
        toolId: selectedTool.id,
        tierId: selectedTier.id,
        assignedAt,
        licenseCode: licenseCode.trim() || undefined,
        bodyMd,
      });
      if (result.success) {
        setAssignmentId(result.data.assignmentId);
        setStep("done");
      } else {
        status.error(result.error);
      }
    });
  }

  /** The paste-ready text: stored body with the key resolved client-side —
   * the admin just typed it, no server roundtrip needed here. */
  function resolvedBody(): string {
    return bodyMd.replace(LICENSE_CODE_TOKEN, licenseCode.trim() || "—");
  }

  function handleDone() {
    onOpenChange(false);
    onSuccess();
  }

  const previewHtml = markdownToTeamsHtml(resolvedBody());
  const hasTemplate =
    selectedTool && selectedTier
      ? resolveTemplate(approvalTemplates, selectedTool.id, selectedTier.id) !== null
      : true;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // After approval the state is committed — closing must refresh.
        if (!next && step === "done") handleDone();
        else onOpenChange(next);
      }}
    >
      {/* sm:max-w-3xl, not max-w-3xl — the DialogContent base sets sm:max-w-lg,
          and an unprefixed override loses to it at desktop widths. */}
      <DialogContent className="sm:max-w-3xl">
        {step === "done" ? (
          <>
            <DialogHeader>
              <DialogTitle>Approved ✓</DialogTitle>
              <DialogDescription>
                Assignment{" "}
                {assignmentId !== null ? (
                  <Link
                    href={`/assignments/${assignmentId}`}
                    className="text-primary hover:underline"
                  >
                    #{assignmentId}
                  </Link>
                ) : null}{" "}
                created. Paste the message into the request&apos;s Teams thread and
                the group chat — nothing is sent automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="relative rounded-md border bg-muted/40 p-4">
              <div className="absolute right-2 top-2">
                <CopySnippetButton getTextAction={() => resolvedBody()} />
              </div>
              <div
                className="break-words text-sm pr-32"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
            <DialogFooter>
              <p className="mr-auto text-xs text-muted-foreground">
                Also available later from the Messages card on this request.
              </p>
              <Button onClick={handleDone}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Approve request — {detail.requesterName}</DialogTitle>
              <DialogDescription>
                {step === 1
                  ? "Step 1 of 2 · assignment — record what you provisioned"
                  : "Step 2 of 2 · message — review, then approve"}
              </DialogDescription>
            </DialogHeader>

            {step === 1 ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Tool</label>
                  <Select
                    value={toolId !== null ? String(toolId) : undefined}
                    onValueChange={handleToolChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select tool" />
                    </SelectTrigger>
                    <SelectContent>
                      {tools.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {detail.requestedToolId === null ? (
                      <>
                        No derived tool for this request
                        {detail.requesterProfile === "indie"
                          ? " (indie — pick per the AI Tooling Guide)"
                          : ""}
                        .
                      </>
                    ) : toolId !== detail.requestedToolId ? (
                      <>Overriding the derived tool ({detail.requestedToolName}).</>
                    ) : (
                      <>Derived from the request&apos;s role/profile mapping.</>
                    )}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Tier</label>
                  <Select
                    value={tierId !== null ? String(tierId) : undefined}
                    onValueChange={(v) => setTierId(Number.parseInt(v, 10))}
                    disabled={!selectedTool}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select tier" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedTool?.tiers.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name} ({Math.round(t.monthlyCostCents / 100)} / mo)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Assignment date</label>
                  <Input
                    type="date"
                    value={assignedAt}
                    onChange={(e) => setAssignedAt(e.target.value)}
                  />
                </div>

                {needsKey && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">API key</label>
                    <Textarea
                      value={licenseCode}
                      onChange={(e) => setLicenseCode(e.target.value)}
                      placeholder="Paste the key you provisioned"
                      className="font-mono text-xs min-h-[80px]"
                    />
                    <p className="text-xs text-muted-foreground">
                      Required for {selectedTool?.name}. Stored encrypted on the
                      assignment; woven into the message on the next step.
                    </p>
                  </div>
                )}

                {willCreateUser && (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                    Hub user will be created: <strong>{detail.requesterName}</strong>{" "}
                    · viewer · no invite email. Rejecting instead creates nothing.
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {!hasTemplate && (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                    No approval template configured for this tool/tier. Configure one under{" "}
                    <a href="/settings/license-templates" className="text-primary underline">
                      Settings → License Templates
                    </a>{" "}
                    to pre-fill future approvals.
                  </div>
                )}
                <div className="grid md:grid-cols-2 gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Markdown{needsKey ? " · {{licenseCode}} stays a placeholder here" : ""}
                    </span>
                    <Textarea
                      value={bodyMd}
                      onChange={(e) => setBodyMd(e.target.value)}
                      className="font-mono text-xs min-h-[260px]"
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Preview · what you&apos;ll paste
                    </span>
                    <div
                      className="min-w-0 break-words rounded-md border bg-muted/40 p-3 min-h-[260px] text-sm"
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  </div>
                </div>
                {needsKey && (
                  <p className="text-xs text-muted-foreground">
                    The stored message keeps <code>{"{{licenseCode}}"}</code>{" "}
                    unresolved — the key lives only encrypted on the assignment.
                    Don&apos;t paste the key into the text.
                  </p>
                )}
              </div>
            )}

            <DialogFooter>
              <p className="mr-auto text-xs text-muted-foreground">
                {step === 1
                  ? "Approving creates the assignment."
                  : "Nothing is sent automatically — you'll get a copy-ready message."}
              </p>
              <StatusText status={status.status} />
              {step === 1 ? (
                <>
                  <Button
                    variant="outline"
                    onClick={() => onOpenChange(false)}
                    disabled={pending}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAdvance}
                    disabled={toolId === null || tierId === null}
                  >
                    Continue →
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" onClick={() => setStep(1)} disabled={pending}>
                    ← Back
                  </Button>
                  <Button
                    onClick={handleApprove}
                    disabled={pending || bodyMd.trim().length === 0}
                  >
                    {pending ? "Approving…" : "Approve & create assignment"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function buildContext(
  detail: LicenseRequestDetail,
  toolName: string,
  tierName: string,
  approver: { name: string; firstName: string },
): TemplateContext {
  const firstName = detail.requesterName.split(/\s+/)[0] ?? detail.requesterName;
  return {
    requester: {
      name: detail.requesterName,
      firstName,
      email: detail.requesterEmail,
    },
    tool: { name: toolName },
    tier: { name: tierName },
    // licenseCode deliberately NOT bound — the token stays literal in the
    // stored message; resolved only for preview/copy.
    approver,
    requestUrl: `${typeof window !== "undefined" ? window.location.origin : ""}/requests/${detail.id}`,
    form: detail.formPayload,
  };
}
