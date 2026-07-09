"use client";

// Tool-mapping settings (032-v2): the (role, profile) → tool rules from the
// AI Tooling Guide, editable as the guide evolves.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteToolMapping,
  upsertToolMapping,
  type ToolMappingRow,
} from "@/actions/tool-mappings";
import type { ToolWithTiers } from "@/actions/license-templates";

const ROLE_LABELS: Record<string, string> = {
  developer: "Development",
  conception: "Conception",
  business: "Business",
};

const PROFILE_LABELS: Record<ToolMappingRow["profile"], string> = {
  baseline: "Baseline",
  maxed: "Maxed",
  indie: "Indie",
};

const ANY_ROLE = "__any__";
const NEEDS_DECISION = "__needs_decision__";
const NO_TIER = "__none__";

interface EditorState {
  id: number | null;
  role: string; // ANY_ROLE or role value
  profile: ToolMappingRow["profile"];
  toolId: string; // NEEDS_DECISION or tool id
  defaultTierId: string; // NO_TIER or tier id
}

export function ToolMappingClient({
  mappings,
  toolsWithTiers,
}: {
  mappings: ToolMappingRow[];
  toolsWithTiers: ToolWithTiers[];
}) {
  const router = useRouter();
  const status = useInlineStatus();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);

  const sorted = useMemo(() => {
    const profileOrder = { baseline: 0, maxed: 1, indie: 2 } as const;
    return [...mappings].sort(
      (a, b) =>
        profileOrder[a.profile] - profileOrder[b.profile] ||
        (a.role ?? "zzz").localeCompare(b.role ?? "zzz"),
    );
  }, [mappings]);

  function openNew() {
    setEditor({
      id: null,
      role: ANY_ROLE,
      profile: "baseline",
      toolId: NEEDS_DECISION,
      defaultTierId: NO_TIER,
    });
  }

  function openEdit(row: ToolMappingRow) {
    setEditor({
      id: row.id,
      role: row.role ?? ANY_ROLE,
      profile: row.profile,
      toolId: row.toolId !== null ? String(row.toolId) : NEEDS_DECISION,
      defaultTierId:
        row.defaultTierId !== null ? String(row.defaultTierId) : NO_TIER,
    });
  }

  async function handleSave() {
    if (!editor) return;
    setSaving(true);
    try {
      const result = await upsertToolMapping({
        role: editor.role === ANY_ROLE ? null : editor.role,
        profile: editor.profile,
        toolId: editor.toolId === NEEDS_DECISION ? null : Number(editor.toolId),
        defaultTierId:
          editor.toolId === NEEDS_DECISION || editor.defaultTierId === NO_TIER
            ? null
            : Number(editor.defaultTierId),
      });
      if (result.success) {
        setEditor(null);
        router.refresh();
      } else {
        status.error(result.error);
      }
    } catch {
      status.error("Saving failed — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: ToolMappingRow) {
    const result = await deleteToolMapping({ id: row.id });
    if (result.success) router.refresh();
    else status.error(result.error);
  }

  const editorTool = editor
    ? toolsWithTiers.find((t) => String(t.id) === editor.toolId)
    : undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <StatusText status={status.status} />
        <Button onClick={openNew}>
          <Plus className="size-4" /> Add mapping
        </Button>
      </div>

      <div className="overflow-x-auto rounded-[14px] border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Profile</TableHead>
              <TableHead>Derived tool</TableHead>
              <TableHead>Default tier</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-24 text-center font-mono text-xs tracking-[0.1em] uppercase text-muted-foreground"
                >
                  [ No mappings — every request needs a manual tool decision ]
                </TableCell>
              </TableRow>
            )}
            {sorted.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Badge variant="secondary">
                    {row.role ? ROLE_LABELS[row.role] : "Any"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{PROFILE_LABELS[row.profile]}</Badge>
                </TableCell>
                <TableCell>
                  {row.toolName ?? (
                    <Badge
                      variant="outline"
                      className="border-amber-400 text-amber-700 dark:text-amber-400"
                    >
                      Needs decision
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {row.defaultTierName ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEdit(row)}
                      aria-label="Edit mapping"
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(row)}
                      aria-label="Delete mapping"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        Resolution: exact (role, profile) row → any-role row for the profile →
        needs decision. Source:{" "}
        <a
          href="https://unicag.sharepoint.com/sites/M-AIIMPACT/SitePages/AI-Tooling-Guide.aspx"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline"
        >
          AI Tooling Guide
        </a>
        .
      </p>

      <Dialog open={editor !== null} onOpenChange={(o) => !o && setEditor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editor?.id === null ? "Add mapping" : "Edit mapping"}
            </DialogTitle>
            <DialogDescription>
              One row per (role, profile) pair. Saving overwrites the existing
              row for that pair.
            </DialogDescription>
          </DialogHeader>
          {editor && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Role</label>
                <Select
                  value={editor.role}
                  onValueChange={(v) => setEditor({ ...editor, role: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY_ROLE}>Any role</SelectItem>
                    <SelectItem value="developer">Development</SelectItem>
                    <SelectItem value="conception">Conception</SelectItem>
                    <SelectItem value="business">Business</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Profile</label>
                <Select
                  value={editor.profile}
                  onValueChange={(v) =>
                    setEditor({ ...editor, profile: v as EditorState["profile"] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baseline">Baseline</SelectItem>
                    <SelectItem value="maxed">Maxed</SelectItem>
                    <SelectItem value="indie">Indie</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Derived tool</label>
                <Select
                  value={editor.toolId}
                  onValueChange={(v) =>
                    setEditor({ ...editor, toolId: v, defaultTierId: NO_TIER })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEEDS_DECISION}>
                      Needs decision (approver picks)
                    </SelectItem>
                    {toolsWithTiers.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {editorTool && editorTool.tiers.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Default tier</label>
                  <Select
                    value={editor.defaultTierId}
                    onValueChange={(v) =>
                      setEditor({ ...editor, defaultTierId: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TIER}>No default</SelectItem>
                      {editorTool.tiers.map((tier) => (
                        <SelectItem key={tier.id} value={String(tier.id)}>
                          {tier.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <StatusText status={status.status} />
            <Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save mapping"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
