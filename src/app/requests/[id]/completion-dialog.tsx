"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
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
import { completeRequest } from "@/actions/license-requests";
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
  tiers: { id: number; name: string; monthlyCostCents: number }[];
  template: string | null;
  approver: { name: string; firstName: string };
  onSuccess: () => void;
}

type Step = 1 | 2;

export function CompletionDialog({
  open,
  onOpenChange,
  detail,
  tiers,
  template,
  approver,
  onSuccess,
}: Props) {
  const today = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const [step, setStep] = useState<Step>(1);
  const [tierId, setTierId] = useState<number | null>(detail.requestedTierId);
  const [licenseCode, setLicenseCode] = useState("");
  const [assignedAt, setAssignedAt] = useState(today);
  const [bodyMd, setBodyMd] = useState("");
  const [pending, startTransition] = useTransition();

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setStep(1);
      setTierId(detail.requestedTierId);
      setLicenseCode("");
      setAssignedAt(today);
      setBodyMd("");
    }
  }, [open, detail.requestedTierId, today]);

  const selectedTier = tiers.find((t) => t.id === tierId) ?? null;

  function handleAdvance() {
    if (!selectedTier) {
      toast.error("Select a tier");
      return;
    }
    // Render the template with the just-entered values bound.
    const ctx = buildContext(detail, selectedTier.name, licenseCode, approver);
    const body = template ? renderTemplate(template, ctx).rendered : "";
    setBodyMd(body);
    setStep(2);
  }

  function handleSend() {
    if (!selectedTier) return;
    startTransition(async () => {
      const result = await completeRequest({
        requestId: detail.id,
        tierId: selectedTier.id,
        licenseCode: licenseCode || undefined,
        assignedAt,
        bodyMd,
      });
      if (result.success) {
        toast.success("Completion sent — assignment created");
        onOpenChange(false);
        onSuccess();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Complete request — {detail.requesterName}</DialogTitle>
          <DialogDescription>
            {detail.requestedToolName} ·{" "}
            {step === 1 ? "step 1 of 2: procurement details" : "step 2 of 2: completion message"}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tier</label>
              <Select
                value={tierId !== null ? String(tierId) : undefined}
                onValueChange={(v) => setTierId(Number.parseInt(v, 10))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select tier" />
                </SelectTrigger>
                <SelectContent>
                  {tiers.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name} ({Math.round(t.monthlyCostCents / 100)} / mo)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Requested:{" "}
                {detail.requestedTierName ?? <span className="italic">(unspecified)</span>}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">License code / API key</label>
              <Textarea
                value={licenseCode}
                onChange={(e) => setLicenseCode(e.target.value)}
                placeholder="Paste the key — encrypted via encryptApiKey() and stored in license_assignments.api_key_encrypted"
                className="font-mono text-xs min-h-[80px]"
              />
              <p className="text-xs text-muted-foreground">
                Optional — leave empty for tools without a code (e.g. seat-only Copilot).
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Assignment date</label>
              <Input
                type="date"
                value={assignedAt}
                onChange={(e) => setAssignedAt(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {!template && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
                No completion template configured for this tool/tier. Configure one under{" "}
                <a href="/settings/license-templates" className="text-primary underline">
                  Settings → License Templates
                </a>{" "}
                to pre-fill future completions.
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
                  className="font-mono text-xs min-h-[240px]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Preview
                </span>
                <div
                  className="rounded-md border bg-muted/40 p-3 min-h-[240px] text-sm"
                  dangerouslySetInnerHTML={{ __html: markdownToTeamsHtml(bodyMd) }}
                />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <p className="mr-auto text-xs text-muted-foreground">
            {step === 1
              ? "An assignment row will be created on send."
              : "Posts to channel + group chat. Completion is terminal."}
          </p>
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancel
              </Button>
              <Button onClick={handleAdvance} disabled={tierId === null}>
                Continue →
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)} disabled={pending}>
                ← Back
              </Button>
              <Button onClick={handleSend} disabled={pending || bodyMd.trim().length === 0}>
                {pending ? "Sending…" : "Send completion"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildContext(
  detail: LicenseRequestDetail,
  tierName: string,
  licenseCode: string,
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
    tier: { name: tierName },
    licenseCode: licenseCode || undefined,
    approver,
    requestUrl: `${typeof window !== "undefined" ? window.location.origin : ""}/requests/${detail.id}`,
    form: detail.formPayload,
  };
}
