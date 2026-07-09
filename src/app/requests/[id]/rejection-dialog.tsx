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
import { CopySnippetButton } from "@/components/copy-snippet";
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
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const status = useInlineStatus();

  // Clear the draft note every time the dialog opens — matches the
  // reset-on-open behavior of ApprovalDialog.
  useEffect(() => {
    if (open) {
      setNote("");
      setDone(false);
    }
  }, [open]);

  function handleReject() {
    startTransition(async () => {
      const result = await rejectRequest({
        requestId: detail.id,
        decisionNote: note.trim(),
      });
      if (result.success) {
        // 032-v2: nothing is posted to Teams — hand the note over as a
        // copy-paste snippet before closing.
        setDone(true);
      } else {
        status.error(result.error);
      }
    });
  }

  function handleDone() {
    onOpenChange(false);
    onSuccess();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && done) handleDone();
        else onOpenChange(next);
      }}
    >
      <DialogContent>
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>Rejected</DialogTitle>
              <DialogDescription>
                Paste the note into the request&apos;s Teams thread and the group
                chat — nothing is sent automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="relative rounded-md border bg-muted/40 p-4">
              <div className="absolute right-2 top-2">
                <CopySnippetButton getTextAction={() => note.trim()} label="Copy note" />
              </div>
              <p className="whitespace-pre-wrap pr-28 text-sm">{note.trim()}</p>
            </div>
            <DialogFooter>
              <Button onClick={handleDone}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Reject request — {detail.requesterName}</DialogTitle>
              <DialogDescription>
                {detail.requestedToolName ?? "No derived tool"}
                {detail.requestedTierName ? ` · ${detail.requestedTierName}` : ""} · you&apos;ll
                get the note as a copy-paste snippet for Teams.
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
                onClick={handleReject}
                disabled={pending || note.trim().length === 0}
              >
                {pending ? "Rejecting…" : "Reject request"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
