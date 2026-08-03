"use client";

// 032-v2 legacy migration path: requests approved under v1 semantics have no
// assignment (approve used to be a decision only; Complete created the
// assignment and is retired). This is step 1 of the approve dialog alone —
// no message, no re-approval.

import { useEffect, useMemo, useState, useTransition } from "react";
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
import {
  recordAssignment,
  linkExistingAssignment,
} from "@/actions/license-requests";
import type {
  ActiveAssignmentSummary,
  LicenseRequestDetail,
  ToolOption,
} from "@/actions/license-requests";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: LicenseRequestDetail;
  tools: ToolOption[];
  /** 042 — the requester's existing active assignments. recordAssignment
   * shares createAssignmentInTx's duplicate-seat guard with approveRequest's
   * `create` mode, so a match here means Save will fail; surfaced up front
   * rather than left to a failed round trip. */
  activeAssignments: ActiveAssignmentSummary[];
  onSuccess: () => void;
}

export function RecordAssignmentDialog({
  open,
  onOpenChange,
  detail,
  tools,
  activeAssignments,
  onSuccess,
}: Props) {
  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const [toolId, setToolId] = useState<number | null>(detail.requestedToolId);
  const [tierId, setTierId] = useState<number | null>(detail.requestedTierId);
  const [licenseCode, setLicenseCode] = useState("");
  const [assignedAt, setAssignedAt] = useState(today);
  const [pending, startTransition] = useTransition();
  const status = useInlineStatus();

  useEffect(() => {
    if (open) {
      setToolId(detail.requestedToolId);
      setTierId(detail.requestedTierId);
      setLicenseCode("");
      setAssignedAt(today);
    }
  }, [open, detail.requestedToolId, detail.requestedTierId, today]);

  const selectedTool = tools.find((t) => t.id === toolId) ?? null;
  const needsKey = selectedTool?.requiresApiKey ?? false;

  // 042 — recordAssignment can only CREATE, and it shares createAssignmentInTx's
  // duplicate-seat guard, so a match here would fail Save. approveRequest's
  // link_existing mode cannot help either: it requires
  // status='pending_review', while this dialog only opens for status='approved'
  // rows (isLegacyApproved) — the guards are mutually exclusive. Hence the
  // dedicated linkExistingAssignment action, which fills in the missing link and
  // touches nothing on the seat.
  const activeMatch =
    toolId !== null
      ? (activeAssignments.find((a) => a.toolId === toolId) ?? null)
      : null;

  function handleToolChange(value: string) {
    const id = Number.parseInt(value, 10);
    setToolId(id);
    const tool = tools.find((t) => t.id === id);
    setTierId(
      tool?.tiers.some((t) => t.id === tierId)
        ? tierId
        : (tool?.tiers[0]?.id ?? null),
    );
  }

  function handleSave() {
    // The seat already exists — link it instead of creating a duplicate.
    if (activeMatch) {
      startTransition(async () => {
        const result = await linkExistingAssignment({
          requestId: detail.id,
          assignmentId: activeMatch.id,
        });
        if (result.success) {
          onOpenChange(false);
          onSuccess();
        } else {
          status.error(result.error);
        }
      });
      return;
    }

    if (toolId === null || tierId === null) {
      status.error("Select a tool and tier");
      return;
    }
    startTransition(async () => {
      const result = await recordAssignment({
        requestId: detail.id,
        toolId,
        tierId,
        assignedAt,
        licenseCode: licenseCode.trim() || undefined,
      });
      if (result.success) {
        onOpenChange(false);
        onSuccess();
      } else {
        status.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record assignment — {detail.requesterName}</DialogTitle>
          <DialogDescription>
            This request was approved before assignments were created at
            approval. Record the result of the procurement — no message is sent.
          </DialogDescription>
        </DialogHeader>
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
          </div>
          {activeMatch && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              {detail.requesterName} already has an active{" "}
              <strong>{activeMatch.toolName}</strong> assignment at{" "}
              <strong>{activeMatch.tierName}</strong> (assignment #
              {activeMatch.id}, since{" "}
              {format(activeMatch.assignedAt, "yyyy-MM-dd")}). This request will
              be <strong>linked to that seat</strong> — nothing on it changes,
              and no second assignment is created. The tier and date fields below
              do not apply.
            </div>
          )}
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
                Required for {selectedTool?.name}. Stored encrypted.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <StatusText status={status.status} />
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            // Linking needs no tool/tier pick — the seat already has both.
            disabled={
              pending || (!activeMatch && (toolId === null || tierId === null))
            }
          >
            {pending
              ? "Saving…"
              : activeMatch
                ? "Link existing seat"
                : "Record assignment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
