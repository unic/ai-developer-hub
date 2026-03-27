"use client";

import { useState, useTransition } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { BrainCircuit, Plus, Pencil, Unplug, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  addPlanConnection,
  updatePlanConnectionLabel,
  disconnectPlanConnection,
  getPlanConnections,
} from "@/actions/plan-connections";
import { syncAllAnthropicUsageForPlan } from "@/actions/anthropic-usage";
import { formatDateTime } from "@/lib/utils";
import type { PlanConnectionListItem } from "@/types";

interface PlanConnectionsCardProps {
  initialConnections: PlanConnectionListItem[];
}

export function PlanConnectionsCard({
  initialConnections,
}: PlanConnectionsCardProps) {
  const [connections, setConnections] =
    useState<PlanConnectionListItem[]>(initialConnections);
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const activeCount = connections.filter((c) => c.status === "active").length;

  async function refreshConnections() {
    const result = await getPlanConnections();
    if (result.success) setConnections(result.data);
  }

  function handleAdd() {
    startTransition(async () => {
      const result = await addPlanConnection({
        label: newLabel,
        adminApiKey: newApiKey,
      });
      if (result.success) {
        toast.success(`Plan "${result.data.label}" connected.`);
        setDialogOpen(false);
        setNewLabel("");
        setNewApiKey("");
        await refreshConnections();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleUpdateLabel(id: number) {
    startTransition(async () => {
      const result = await updatePlanConnectionLabel(id, editLabel);
      if (result.success) {
        toast.success("Label updated.");
        setEditingId(null);
        await refreshConnections();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleSync(id: number, label: string) {
    startTransition(async () => {
      const result = await syncAllAnthropicUsageForPlan(id);
      if (result.success) {
        toast.success(`Sync started for "${label}".`);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDisconnect(id: number) {
    startTransition(async () => {
      const result = await disconnectPlanConnection(id);
      if (result.success) {
        toast.success("Plan disconnected.");
        await refreshConnections();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="size-5" />
            Claude API Plans
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={activeCount > 0 ? "default" : "secondary"}>
              {activeCount} Active
            </Badge>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={activeCount >= 10}>
                  <Plus className="size-4 mr-1" />
                  Add Plan
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Connect Claude API Plan</DialogTitle>
                  <DialogDescription>
                    Add an Anthropic admin API key to connect a new plan.
                    The key will be encrypted and stored securely.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="plan-label">Label</Label>
                    <Input
                      id="plan-label"
                      placeholder="e.g. Engineering Plan"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      maxLength={200}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="plan-api-key">Admin API Key</Label>
                    <Input
                      id="plan-api-key"
                      type="password"
                      placeholder="sk-ant-admin01-..."
                      value={newApiKey}
                      onChange={(e) => setNewApiKey(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={handleAdd}
                    disabled={isPending || !newLabel.trim() || !newApiKey.trim()}
                  >
                    {isPending ? (
                      <RefreshCw className="size-4 mr-1 animate-spin" />
                    ) : null}
                    Connect Plan
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No plan connections configured. Add one to enable Claude API cost tracking.
          </p>
        ) : (
          <div className="space-y-3">
            {connections.map((conn) => (
              <div
                key={conn.id}
                className="flex items-center justify-between rounded-md border p-3"
              >
                <div className="space-y-1">
                  {editingId === conn.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        className="h-7 w-48"
                        maxLength={200}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleUpdateLabel(conn.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleUpdateLabel(conn.id)}
                        disabled={isPending}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{conn.label}</span>
                      {conn.status === "active" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0"
                          onClick={() => {
                            setEditingId(conn.id);
                            setEditLabel(conn.label);
                          }}
                        >
                          <Pencil className="size-3" />
                        </Button>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <code>{conn.adminApiKeyHint}</code>
                    <span>Added {formatDateTime(conn.createdAt.toString())}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {conn.status === "active" ? (
                    <>
                      <Badge variant="default">Connected</Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        title="Sync this plan"
                        onClick={() => handleSync(conn.id, conn.label)}
                      >
                        <RefreshCw className={`size-4 ${isPending ? "animate-spin" : ""}`} />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={activeCount <= 1}
                            title={
                              activeCount <= 1
                                ? "Cannot disconnect the only active plan"
                                : "Disconnect plan"
                            }
                          >
                            <Unplug className="size-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Disconnect plan?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will stop syncing usage data from &quot;{conn.label}&quot;.
                              Historical data will be preserved.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDisconnect(conn.id)}
                            >
                              Disconnect
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  ) : (
                    <Badge variant="secondary">Disconnected</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
