"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ColumnDef } from "@tanstack/react-table";
import { assignLicense, revokeLicense } from "@/actions/assignments";
import { getToolWithTiers } from "@/actions/tools";
import { DataTable } from "@/components/data-table";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { AiTool, User, AccessTier } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";

interface AssignmentRow {
  id: number;
  status: string;
  costAtAssignmentCents: number;
  assignedAt: Date | null;
  revokedAt: Date | null;
  user: { id: number; name: string; email: string };
  tool: { id: number; name: string };
  tier: { id: number; name: string };
}

interface Props {
  assignments: AssignmentRow[];
  tools: AiTool[];
  users: User[];
  isAdmin: boolean;
}

export function AssignmentsClient({
  assignments,
  tools,
  users,
  isAdmin,
}: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [selectedToolId, setSelectedToolId] = useState<string>("");
  const [selectedTierId, setSelectedTierId] = useState<string>("");
  const [availableTiers, setAvailableTiers] = useState<AccessTier[]>([]);
  const [assigning, setAssigning] = useState(false);

  async function handleToolChange(toolId: string) {
    setSelectedToolId(toolId);
    setSelectedTierId("");
    if (toolId) {
      const tool = await getToolWithTiers(Number(toolId));
      setAvailableTiers(
        tool?.accessTiers.filter((t) => t.isActive) ?? []
      );
    } else {
      setAvailableTiers([]);
    }
  }

  async function handleAssign() {
    if (!selectedUserId || !selectedToolId || !selectedTierId) return;
    setAssigning(true);
    const result = await assignLicense({
      userId: Number(selectedUserId),
      toolId: Number(selectedToolId),
      tierId: Number(selectedTierId),
    });
    setAssigning(false);
    if (result.success) {
      toast.success("License assigned");
      setDialogOpen(false);
      setSelectedUserId("");
      setSelectedToolId("");
      setSelectedTierId("");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function handleRevoke(id: number) {
    const result = await revokeLicense({ id });
    if (result.success) {
      toast.success("License revoked");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  const columns: ColumnDef<AssignmentRow>[] = [
    {
      accessorFn: (row) => row.user.name,
      id: "userName",
      header: "User",
    },
    {
      accessorFn: (row) => row.tool.name,
      id: "toolName",
      header: "Tool",
    },
    {
      accessorFn: (row) => row.tier.name,
      id: "tierName",
      header: "Tier",
    },
    {
      accessorKey: "costAtAssignmentCents",
      header: "Monthly Cost",
      cell: ({ row }) => formatCurrency(row.original.costAtAssignmentCents),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge
          variant={
            row.original.status === "active" ? "default" : "secondary"
          }
        >
          {row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: "assignedAt",
      header: "Assigned",
      cell: ({ row }) => formatDate(row.original.assignedAt),
    },
    ...(isAdmin
      ? [
          {
            id: "actions" as const,
            cell: ({ row }: { row: { original: AssignmentRow } }) =>
              row.original.status === "active" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRevoke(row.original.id)}
                >
                  Revoke
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">License Assignments</h1>
          <p className="text-muted-foreground">
            Track user-to-tool license assignments
          </p>
        </div>
        {isAdmin && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 size-4" />
                Assign License
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Assign License</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">User</label>
                  <Select
                    value={selectedUserId}
                    onValueChange={setSelectedUserId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select user" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          {u.name} ({u.email})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm font-medium">Tool</label>
                  <Select
                    value={selectedToolId}
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
                <div>
                  <label className="text-sm font-medium">Tier</label>
                  <Select
                    value={selectedTierId}
                    onValueChange={setSelectedTierId}
                    disabled={availableTiers.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select tier" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableTiers.map((t) => (
                        <SelectItem key={t.id} value={String(t.id)}>
                          {t.name} — {formatCurrency(t.monthlyCostCents)}/mo
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleAssign}
                  disabled={
                    !selectedUserId ||
                    !selectedToolId ||
                    !selectedTierId ||
                    assigning
                  }
                  className="w-full"
                >
                  {assigning ? "Assigning..." : "Assign License"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <DataTable
        columns={columns}
        data={assignments}
        searchPlaceholder="Search assignments..."
      />
    </div>
  );
}
