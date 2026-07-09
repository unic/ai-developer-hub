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
import { recordAssignment } from "@/actions/license-requests";
import type { LicenseRequestDetail, ToolOption } from "@/actions/license-requests";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: LicenseRequestDetail;
  tools: ToolOption[];
  onSuccess: () => void;
}

export function RecordAssignmentDialog({
  open,
  onOpenChange,
  detail,
  tools,
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
          <Button onClick={handleSave} disabled={pending || toolId === null || tierId === null}>
            {pending ? "Saving…" : "Record assignment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
