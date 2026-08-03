"use client";

import { useState, useTransition, useMemo } from "react";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import {
  upsertMessageTemplate,
  deleteMessageTemplate,
} from "@/actions/license-templates";
import {
  renderTemplate,
  KNOWN_VARIABLE_PATHS,
  type TemplateContext,
} from "@/lib/license-requests/render-template";
import { markdownToTeamsHtml } from "@/lib/teams/markdown";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: {
    toolId: number;
    toolName: string;
    tierId: number | null;
    tierName: string | null;
    kind: "approval" | "completion";
    existingId: number | null;
    bodyMd: string;
  };
}

const SAMPLE_CONTEXT: TemplateContext = {
  requester: {
    name: "Sample Requester",
    firstName: "Sample",
    email: "sample@example.com",
  },
  tool: { name: "Sample Tool" },
  // previousName is non-empty in the sample so an author previewing a template
  // can see what {{tier.previousName}} renders on a tier-change approval. On a
  // create-mode approval it resolves to the empty string.
  tier: { name: "Sample Tier", previousName: "Previous Sample Tier" },
  licenseCode: "sk-sample-1234-redacted",
  approver: { name: "Sample Approver", firstName: "Sample" },
  requestUrl: "https://aihub.example.com/requests/0",
  form: {
    github_username: "sampleuser",
    justification: "Sample justification",
  },
};

export function TemplateEditorDialog({ open, onOpenChange, state }: Props) {
  const [bodyMd, setBodyMd] = useState(state.bodyMd);
  const [pending, startTransition] = useTransition();
  const status = useInlineStatus();

  // Build the actual sample context for THIS template (tool / tier names match).
  const ctx: TemplateContext = useMemo(
    () => ({
      ...SAMPLE_CONTEXT,
      tool: { name: state.toolName },
      tier: state.tierName
        ? {
            name: state.tierName,
            previousName: SAMPLE_CONTEXT.tier?.previousName ?? "",
          }
        : SAMPLE_CONTEXT.tier,
      licenseCode: state.kind === "completion" ? SAMPLE_CONTEXT.licenseCode : undefined,
    }),
    [state.toolName, state.tierName, state.kind],
  );

  const { rendered, missingVariables } = renderTemplate(bodyMd, ctx);
  const previewHtml = markdownToTeamsHtml(rendered);

  function handleSave() {
    startTransition(async () => {
      const result = await upsertMessageTemplate({
        toolId: state.toolId,
        tierId: state.tierId,
        kind: state.kind,
        bodyMd,
      });
      if (result.success) {
        onOpenChange(false);
      } else {
        status.error(result.error);
      }
    });
  }

  function handleDelete() {
    if (!state.existingId) return;
    startTransition(async () => {
      const result = await deleteMessageTemplate({ id: state.existingId! });
      if (result.success) {
        onOpenChange(false);
      } else {
        status.error(result.error);
      }
    });
  }

  function insertVariable(path: string) {
    const insert = `{{${path}}}`;
    setBodyMd((b) => `${b}${b.endsWith("\n") || b.length === 0 ? "" : " "}${insert}`);
  }

  const title = `${state.toolName} · ${state.tierName ?? "(tool default)"} · ${state.kind}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {state.tierId === null
              ? "Tool-wide default. Inherited by tiers without an override."
              : "Tier-specific override. Delete to fall back to the tool default."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_180px] gap-3">
          {/* source */}
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Markdown
            </span>
            <Textarea
              value={bodyMd}
              onChange={(e) => setBodyMd(e.target.value)}
              className="font-mono text-xs min-h-[280px]"
            />
          </div>
          {/* preview */}
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Preview (sample data)
            </span>
            <div
              className="rounded-md border bg-muted/40 p-3 min-h-[280px] text-sm prose-sm dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
          {/* variable picker */}
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              Variables · click to insert
            </span>
            <div className="rounded-md border bg-muted/40 p-2 min-h-[280px] overflow-y-auto text-xs space-y-1">
              {KNOWN_VARIABLE_PATHS.map((path) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => insertVariable(path)}
                  className="block w-full text-left font-mono px-2 py-1 rounded hover:bg-accent hover:text-accent-foreground"
                >
                  {`{{${path}}}`}
                </button>
              ))}
              <div className="text-muted-foreground italic pt-2 px-2">
                Plus any <code>{`{{form.<key>}}`}</code> from the Forms submission.
              </div>
            </div>
          </div>
        </div>

        {missingVariables.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-warning p-3 text-sm">
            <AlertTriangle className="size-4 text-warning mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-warning">
                Unknown variable{missingVariables.length === 1 ? "" : "s"}
              </p>
              <p className="text-muted-foreground text-xs mt-1">
                Will render as literal text unless data exists at request time:
              </p>
              <div className="flex flex-wrap gap-1 mt-1">
                {missingVariables.map((v) => (
                  <Badge key={v} variant="outline" className="font-mono text-[11px]">
                    {`{{${v}}}`}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <div>
            {state.existingId !== null && state.tierId !== null && (
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={pending}
              >
                Delete override
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <StatusText status={status.status} />
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={pending}>
              {pending ? "Saving…" : "Save template"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
