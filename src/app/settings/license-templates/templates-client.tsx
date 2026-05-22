"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Pencil } from "lucide-react";
import type { MessageTemplateRow, ToolWithTiers } from "@/actions/license-templates";
import { TemplateEditorDialog } from "./template-editor-dialog";

interface Props {
  templates: MessageTemplateRow[];
  toolsWithTiers: ToolWithTiers[];
}

interface EditorState {
  toolId: number;
  toolName: string;
  tierId: number | null;
  tierName: string | null;
  kind: "approval" | "completion";
  existingId: number | null;
  bodyMd: string;
}

export function TemplatesClient({ templates, toolsWithTiers }: Props) {
  const [editor, setEditor] = useState<EditorState | null>(null);

  const byTool = useMemo(() => {
    const groups = new Map<number, MessageTemplateRow[]>();
    for (const t of templates) {
      const arr = groups.get(t.toolId) ?? [];
      arr.push(t);
      groups.set(t.toolId, arr);
    }
    return groups;
  }, [templates]);

  function openEditor(args: {
    toolId: number;
    toolName: string;
    tierId: number | null;
    tierName: string | null;
    kind: "approval" | "completion";
  }) {
    const existing = templates.find(
      (t) => t.toolId === args.toolId && t.tierId === args.tierId && t.kind === args.kind,
    );
    setEditor({
      ...args,
      existingId: existing?.id ?? null,
      bodyMd: existing?.bodyMd ?? defaultBody(args.kind, args.toolName, args.tierName),
    });
  }

  return (
    <div className="space-y-4">
      {toolsWithTiers.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No active tools yet. Add a tool first under Tools.
          </CardContent>
        </Card>
      )}
      {toolsWithTiers.map((tool) => {
        const rows = byTool.get(tool.id) ?? [];
        const defaults = rows.filter((r) => r.tierId === null);
        return (
          <Card key={tool.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-lg">{tool.name}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {tool.tiers.length} tier{tool.tiers.length === 1 ? "" : "s"} ·{" "}
                  {rows.length} template{rows.length === 1 ? "" : "s"}
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Tool-wide defaults */}
              <div className="space-y-2">
                <h4 className="text-xs uppercase tracking-wide text-muted-foreground">
                  Tool defaults
                </h4>
                {(["approval", "completion"] as const).map((kind) => {
                  const row = defaults.find((d) => d.kind === kind);
                  return (
                    <TemplateRow
                      key={`tool-${tool.id}-${kind}`}
                      kindLabel={kind}
                      tierLabel="(tool default)"
                      tierIsDefault
                      bodyMd={row?.bodyMd ?? null}
                      hasOverride={false}
                      onEdit={() =>
                        openEditor({
                          toolId: tool.id,
                          toolName: tool.name,
                          tierId: null,
                          tierName: null,
                          kind,
                        })
                      }
                    />
                  );
                })}
              </div>

              {/* Per-tier overrides */}
              {tool.tiers.length > 0 && (
                <div className="space-y-2 pt-2 border-t">
                  <h4 className="text-xs uppercase tracking-wide text-muted-foreground">
                    Per-tier overrides
                  </h4>
                  {tool.tiers.map((tier) =>
                    (["approval", "completion"] as const).map((kind) => {
                      const row = rows.find((r) => r.tierId === tier.id && r.kind === kind);
                      return (
                        <TemplateRow
                          key={`tier-${tier.id}-${kind}`}
                          kindLabel={kind}
                          tierLabel={tier.name}
                          tierIsDefault={false}
                          bodyMd={row?.bodyMd ?? null}
                          hasOverride={row !== undefined}
                          onEdit={() =>
                            openEditor({
                              toolId: tool.id,
                              toolName: tool.name,
                              tierId: tier.id,
                              tierName: tier.name,
                              kind,
                            })
                          }
                        />
                      );
                    }),
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {editor && (
        <TemplateEditorDialog
          open
          onOpenChange={(open) => !open && setEditor(null)}
          state={editor}
        />
      )}
    </div>
  );
}

function TemplateRow(props: {
  kindLabel: "approval" | "completion";
  tierLabel: string;
  tierIsDefault: boolean;
  bodyMd: string | null;
  hasOverride: boolean;
  onEdit: () => void;
}) {
  const snippet = props.bodyMd
    ? props.bodyMd.replace(/\s+/g, " ").slice(0, 80)
    : null;
  return (
    <div className="flex items-center gap-3 rounded-md border bg-card px-3 py-2 text-sm">
      <span
        className={
          props.tierIsDefault
            ? "text-muted-foreground italic w-40"
            : "font-medium w-40"
        }
      >
        {props.tierLabel}
        {props.hasOverride && (
          <Badge variant="secondary" className="ml-2 text-[10px]">
            override
          </Badge>
        )}
      </span>
      <Badge
        variant={props.kindLabel === "approval" ? "default" : "outline"}
        className="capitalize text-[11px]"
      >
        {props.kindLabel}
      </Badge>
      <span className="flex-1 truncate font-mono text-xs text-muted-foreground">
        {snippet ?? <span className="italic">no template set</span>}
      </span>
      <Button size="sm" variant={snippet ? "outline" : "default"} onClick={props.onEdit}>
        {snippet ? (
          <>
            <Pencil className="size-3" />
            Edit
          </>
        ) : (
          <>
            <Plus className="size-3" />
            Create
          </>
        )}
      </Button>
    </div>
  );
}

function defaultBody(
  kind: "approval" | "completion",
  toolName: string,
  tierName: string | null,
): string {
  const tierClause = tierName ? ` at the ${tierName} tier` : "";
  if (kind === "approval") {
    return [
      `Hi {{requester.firstName}},`,
      ``,
      `Your request for **${toolName}**${tierClause} has been approved. Procurement is in progress — you'll get a follow-up once your license is ready.`,
      ``,
      `Track the request here: {{requestUrl}}`,
      ``,
      `— {{approver.firstName}}`,
    ].join("\n");
  }
  return [
    `Hi {{requester.firstName}},`,
    ``,
    `Your **${toolName}**${tierClause} access is ready.`,
    ``,
    `**License code:** \`{{licenseCode}}\``,
    ``,
    `Save it somewhere safe — we cannot display it again. Let us know in this thread if anything's off.`,
    ``,
    `— {{approver.firstName}}`,
  ].join("\n");
}
