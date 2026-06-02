"use client";

import { useEffect, useState, useTransition } from "react";
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
import { rejectRequest } from "@/actions/license-requests";
import type { LicenseRequestDetail } from "@/actions/license-requests";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: LicenseRequestDetail;
  onSuccess: () => void;
}

export function RejectionDialog({ open, onOpenChange, detail, onSuccess }: Props) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const status = useInlineStatus();

  // Clear the draft note every time the dialog opens — matches the
  // reset-on-open behavior of CompletionDialog and ApprovalDialog.
  useEffect(() => {
    if (open) setNote("");
  }, [open]);

  function handleSend() {
    startTransition(async () => {
      const result = await rejectRequest({
        requestId: detail.id,
        decisionNote: note.trim(),
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
          <DialogTitle>Reject request — {detail.requesterName}</DialogTitle>
          <DialogDescription>
            {detail.requestedToolName}
            {detail.requestedTierName ? ` · ${detail.requestedTierName}` : ""} · the requester
            will receive this message in the group chat.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="reject-note">
            Reason
          </label>
          <Textarea
            id="reject-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Budget exhausted this quarter; please re-apply in Q3"
            className="min-h-[140px]"
          />
          <p className="text-xs text-muted-foreground">
            Plain text — no template. Status will transition to <code>rejected</code> (terminal).
          </p>
        </div>
        <DialogFooter>
          <StatusText status={status.status} />
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleSend}
            disabled={pending || note.trim().length === 0}
          >
            {pending ? "Sending…" : "Send rejection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
