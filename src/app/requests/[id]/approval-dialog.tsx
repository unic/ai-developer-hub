"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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
import { approveRequest } from "@/actions/license-requests";
import type { LicenseRequestDetail } from "@/actions/license-requests";
import {
  renderTemplate,
  type TemplateContext,
} from "@/lib/license-requests/render-template";
import { markdownToTeamsHtml } from "@/lib/teams/markdown";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: LicenseRequestDetail;
  template: string | null;
  approver: { name: string; firstName: string };
  onSuccess: () => void;
}

export function ApprovalDialog({
  open,
  onOpenChange,
  detail,
  template,
  approver,
  onSuccess,
}: Props) {
  const initialBody = useMemo(() => {
    if (!template) return "";
    const ctx = buildContext(detail, approver);
    return renderTemplate(template, ctx).rendered;
  }, [detail, template, approver]);

  const [bodyMd, setBodyMd] = useState(initialBody);
  const [pending, startTransition] = useTransition();
  const status = useInlineStatus();
  const previewHtml = markdownToTeamsHtml(bodyMd);

  // Reset to the freshly-rendered template every time the dialog opens —
  // otherwise edits from a prior open-then-cancel session persist.
  useEffect(() => {
    if (open) setBodyMd(initialBody);
  }, [open, initialBody]);

  function handleSend() {
    startTransition(async () => {
      const result = await approveRequest({
        requestId: detail.id,
        bodyMd,
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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Approve request — {detail.requesterName}</DialogTitle>
          <DialogDescription>
            {detail.requestedToolName}
            {detail.requestedTierName ? ` · ${detail.requestedTierName}` : ""} · review and edit before sending
          </DialogDescription>
        </DialogHeader>
        {!template && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            No approval template configured for this tool/tier. Configure one under{" "}
            <a href="/settings/license-templates" className="text-primary underline">
              Settings → License Templates
            </a>{" "}
            to pre-fill future approvals.
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Markdown
            </span>
            <Textarea
              value={bodyMd}
              onChange={(e) => setBodyMd(e.target.value)}
              className="font-mono text-xs min-h-[260px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Preview
            </span>
            <div
              className="rounded-md border bg-muted/40 p-3 min-h-[260px] text-sm"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
        <DialogFooter>
          <p className="mr-auto text-xs text-muted-foreground">
            Posts to channel thread + group chat.
          </p>
          <StatusText status={status.status} />
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={pending || bodyMd.trim().length === 0}>
            {pending ? "Sending…" : "Send approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildContext(
  detail: LicenseRequestDetail,
  approver: { name: string; firstName: string },
): TemplateContext {
  const firstName = detail.requesterName.split(/\s+/)[0] ?? detail.requesterName;
  return {
    requester: {
      name: detail.requesterName,
      firstName,
      email: detail.requesterEmail,
    },
    tool: { name: detail.requestedToolName },
    tier: detail.requestedTierName ? { name: detail.requestedTierName } : null,
    approver,
    requestUrl: `${typeof window !== "undefined" ? window.location.origin : ""}/requests/${detail.id}`,
    form: detail.formPayload,
  };
}
