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
import type {
  ActiveAssignmentSummary,
  LicenseRequestDetail,
  ToolOption,
} from "@/actions/license-requests";
import type { ApprovalTemplateRow } from "@/lib/license-requests/templates";
import type { ApproveRequestInput } from "@/lib/validators";
import {
  renderTemplate,
  type TemplateContext,
} from "@/lib/license-requests/render-template";
import { markdownToTeamsHtml } from "@/lib/teams/markdown";
import { tierCostDeltaCents } from "@/lib/assignments/tier-change";
import { formatCurrency, formatVariance } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: LicenseRequestDetail;
  tools: ToolOption[];
  /** 042 — the requester's existing active assignments; drives the mode
   * (create / change_tier / link_existing) via a toolId match. */
  activeAssignments: ActiveAssignmentSummary[];
  approvalTemplates: ApprovalTemplateRow[];
  approver: { name: string; firstName: string };
  onSuccess: () => void;
}

type Step = 1 | 2 | "done";

/** 042 — derived from the toolId/activeAssignments match, never chosen
 * directly by the admin. See the `mode` computation in the component. */
type ApprovalMode = "create" | "change_tier" | "link_existing";

const FOOTER_HINT: Record<ApprovalMode, string> = {
  create: "Approving creates the assignment.",
  change_tier: "Approving retiers the existing assignment in place.",
  link_existing: "Approving links the existing seat — nothing on it changes.",
};

const PRIMARY_LABEL: Record<ApprovalMode, string> = {
  create: "Approve & create assignment",
  change_tier: "Approve & change tier",
  link_existing: "Approve & link existing seat",
};

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
  activeAssignments,
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

  // 042 — collision detection keys on toolId, never on display name (two tools
  // can share a name across vendors; ActiveAssignmentSummary carries the id
  // precisely so this doesn't have to guess). A sync-managed match can only be
  // linked — GitHub owns that seat's plan — anything else is retiered in place.
  const activeMatch =
    toolId !== null
      ? (activeAssignments.find((a) => a.toolId === toolId) ?? null)
      : null;
  const mode: ApprovalMode =
    activeMatch === null
      ? "create"
      : activeMatch.syncManaged
        ? "link_existing"
        : "change_tier";
  // link_existing never needs a tier pick — the seat's own tier is unaffected.
  const canContinue = toolId !== null && (mode === "link_existing" || tierId !== null);

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
    if (mode === "link_existing") {
      if (!activeMatch) {
        status.error("Select a tool");
        return;
      }
      // Nothing is being mutated — tool/tier stay the seat's current ones, so
      // tier.previousName has nothing to report and stays "".
      const template = resolveTemplate(approvalTemplates, activeMatch.toolId, activeMatch.tierId);
      const ctx = buildContext(detail, activeMatch.toolName, activeMatch.tierName, approver);
      setBodyMd(template ? renderTemplate(template, ctx).rendered : "");
      setStep(2);
      return;
    }

    if (!selectedTool || !selectedTier) {
      status.error("Select a tool and tier");
      return;
    }
    // The API-key rule is create-only: a retier reuses the seat's stored key.
    if (mode === "create" && needsKey && licenseCode.trim().length === 0) {
      status.error(`${selectedTool.name} needs the API key you provisioned`);
      return;
    }
    // Render the template with everything EXCEPT licenseCode bound — the
    // token stays literal so the stored message never contains the key
    // (see getRequestMessage in actions/license-requests.ts). previousTierName
    // is only ever non-empty on a retier — see TemplateContext.tier.
    const previousTierName =
      mode === "change_tier" && activeMatch ? activeMatch.tierName : "";
    const template = resolveTemplate(approvalTemplates, selectedTool.id, selectedTier.id);
    const ctx = buildContext(
      detail,
      selectedTool.name,
      selectedTier.name,
      approver,
      previousTierName,
    );
    setBodyMd(template ? renderTemplate(template, ctx).rendered : "");
    setStep(2);
  }

  /** Fire the approval and resolve to the shared success/error handling —
   * factored out so each mode's payload can be built with its own narrowed
   * locals (selectedTool!/activeMatch! assertions would otherwise be needed
   * inside the startTransition closure). */
  function submitApproval(payload: ApproveRequestInput) {
    startTransition(async () => {
      const result = await approveRequest(payload);
      if (result.success) {
        setAssignmentId(result.data.assignmentId);
        setStep("done");
      } else {
        // 042 — the server re-validates the mode against reality (e.g. the
        // matched assignment was revoked between opening this dialog and
        // approving) and can reject with an instruction to reopen the dialog.
        // Surface it here rather than swallowing it.
        status.error(result.error);
      }
    });
  }

  function handleApprove() {
    if (mode === "create") {
      if (!selectedTool || !selectedTier) return;
      submitApproval({
        mode: "create",
        requestId: detail.id,
        toolId: selectedTool.id,
        tierId: selectedTier.id,
        assignedAt,
        licenseCode: licenseCode.trim() || undefined,
        bodyMd,
      });
      return;
    }
    if (mode === "change_tier") {
      if (!activeMatch || !selectedTool || !selectedTier) return;
      submitApproval({
        mode: "change_tier",
        requestId: detail.id,
        assignmentId: activeMatch.id,
        toolId: selectedTool.id,
        tierId: selectedTier.id,
        licenseCode: licenseCode.trim() || undefined,
        bodyMd,
      });
      return;
    }
    // link_existing — mutate nothing, just approve and link.
    if (!activeMatch) return;
    submitApproval({
      mode: "link_existing",
      requestId: detail.id,
      assignmentId: activeMatch.id,
      bodyMd,
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
    mode === "link_existing"
      ? activeMatch
        ? resolveTemplate(approvalTemplates, activeMatch.toolId, activeMatch.tierId) !== null
        : true
      : selectedTool && selectedTier
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

                {mode === "change_tier" && activeMatch && (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm">
                    {detail.requesterName} already holds{" "}
                    <strong>{activeMatch.toolName}</strong> at{" "}
                    <strong>{activeMatch.tierName}</strong> (
                    <Link
                      href={`/assignments/${activeMatch.id}`}
                      className="text-primary hover:underline"
                    >
                      assignment #{activeMatch.id}
                    </Link>
                    , since {format(activeMatch.assignedAt, "yyyy-MM-dd")}).
                    Approving moves that seat to the tier selected below — its
                    id, comments and API key are unchanged.
                  </div>
                )}

                {mode === "link_existing" && activeMatch && (
                  <div className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-sm">
                    <p>
                      {detail.requesterName} already holds{" "}
                      <strong>{activeMatch.toolName}</strong> at{" "}
                      <strong>{activeMatch.tierName}</strong> (
                      <Link
                        href={`/assignments/${activeMatch.id}`}
                        className="text-primary hover:underline"
                      >
                        assignment #{activeMatch.id}
                      </Link>
                      ), managed by GitHub Copilot sync — GitHub owns this
                      seat&apos;s plan, not the Hub.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Change the plan in GitHub — it arrives here on the next
                      sync. Approving just records the decision and links the
                      existing seat; nothing on the assignment changes.
                    </p>
                  </div>
                )}

                {mode !== "link_existing" && (
                  <>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">
                        {mode === "change_tier" ? "New tier" : "Tier"}
                      </label>
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
                      {mode === "change_tier" && activeMatch && selectedTier && (
                        <p className="text-xs text-muted-foreground">
                          {selectedTier.id === activeMatch.tierId ? (
                            "Same tier as today — approving just links the request; nothing on the assignment changes."
                          ) : (
                            <>
                              Monthly tier cost: {formatCurrency(activeMatch.tierCostCents)}
                              {" → "}
                              {formatCurrency(selectedTier.monthlyCostCents)} (
                              {formatVariance(
                                tierCostDeltaCents(
                                  activeMatch.tierCostCents,
                                  selectedTier.monthlyCostCents,
                                ),
                              )}
                              /mo). That&apos;s the tier&apos;s monthly cost, not
                              necessarily the bill — metered tools (Claude
                              Console) charge separately for actual usage.
                            </>
                          )}
                        </p>
                      )}
                    </div>

                    {mode === "create" && (
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">Assignment date</label>
                        <Input
                          type="date"
                          value={assignedAt}
                          onChange={(e) => setAssignedAt(e.target.value)}
                        />
                      </div>
                    )}

                    {needsKey && (
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">
                          API key{mode === "change_tier" ? " (optional)" : ""}
                        </label>
                        <Textarea
                          value={licenseCode}
                          onChange={(e) => setLicenseCode(e.target.value)}
                          placeholder="Paste the key you provisioned"
                          className="font-mono text-xs min-h-[80px]"
                        />
                        <p className="text-xs text-muted-foreground">
                          {mode === "create" ? (
                            <>
                              Required for {selectedTool?.name}. Stored
                              encrypted on the assignment; woven into the
                              message on the next step.
                            </>
                          ) : (
                            <>
                              Optional — the seat keeps its stored key either
                              way. Leave blank to keep using it as-is; the{" "}
                              <code>{"{{licenseCode}}"}</code> token in the
                              snippet stays unresolved unless you re-enter it
                              here.
                            </>
                          )}
                        </p>
                      </div>
                    )}
                  </>
                )}

                {mode === "create" && willCreateUser && (
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
                  ? FOOTER_HINT[mode]
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
                  <Button onClick={handleAdvance} disabled={!canContinue}>
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
                    {pending ? "Approving…" : PRIMARY_LABEL[mode]}
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
  /** Tier being moved off, for a change_tier approval. "" on a create (042). */
  previousTierName: string = "",
): TemplateContext {
  const firstName = detail.requesterName.split(/\s+/)[0] ?? detail.requesterName;
  return {
    requester: {
      name: detail.requesterName,
      firstName,
      email: detail.requesterEmail,
    },
    tool: { name: toolName },
    tier: { name: tierName, previousName: previousTierName },
    // licenseCode deliberately NOT bound — the token stays literal in the
    // stored message; resolved only for preview/copy.
    approver,
    requestUrl: `${typeof window !== "undefined" ? window.location.origin : ""}/requests/${detail.id}`,
    form: detail.formPayload,
  };
}
