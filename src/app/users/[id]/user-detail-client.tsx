"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import { updateUser, deactivateUser } from "@/actions/users";
import { ResetPasswordDialog } from "@/components/reset-password-dialog";
import { updateUserSchema, type UpdateUserInput } from "@/lib/validators";
import { assignLicense, revokeLicense } from "@/actions/assignments";
import { getTools, getToolWithTiers } from "@/actions/tools";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { User, ChangeHistoryRecord, CostData, AiTool, AccessTier } from "@/types";
import { AdminCostSection } from "@/components/profile/admin-cost-section";
import { DISCIPLINES, DISCIPLINE_ICON, DISCIPLINE_LABEL, asDiscipline } from "@/lib/disciplines";
import { Github, ExternalLink, BookOpen, KeyRound, Plus, RotateCcw, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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

const editUserSchema = updateUserSchema.omit({ id: true });

type EditUserInput = Omit<UpdateUserInput, "id">;

interface Assignment {
  id: number;
  status: string;
  costAtAssignmentCents: number;
  assignedAt: Date | null;
  revokedAt: Date | null;
  tool: { id: number; name: string; status: string };
  tier: { id: number; name: string };
}

interface GitHubProfileData {
  githubLogin: string;
  avatarUrl: string | null;
  bio: string | null;
  publicRepos: number | null;
  profileUrl: string | null;
  name: string | null;
  lastSyncedAt: Date;
}

interface Props {
  user: User;
  assignments: Assignment[];
  history: ChangeHistoryRecord[];
  isAdmin: boolean;
  githubProfile?: GitHubProfileData | null;
  costData: CostData;
  costAvailableMonths: string[];
}

export function UserDetailClient({
  user,
  assignments,
  history,
  isAdmin,
  githubProfile,
  costData,
  costAvailableMonths,
}: Props) {
  const router = useRouter();
  const status = useInlineStatus();
  const assignStatus = useInlineStatus();
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [tools, setTools] = useState<AiTool[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [selectedToolId, setSelectedToolId] = useState<string>("");
  const [selectedTierId, setSelectedTierId] = useState<string>("");
  const [availableTiers, setAvailableTiers] = useState<AccessTier[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [reactivatingId, setReactivatingId] = useState<number | null>(null);
  const [assignWorkspace, setAssignWorkspace] = useState("");
  const [assignApiKey, setAssignApiKey] = useState("");
  const [showAssignApiKey, setShowAssignApiKey] = useState(false);

  const form = useForm<EditUserInput>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      name: user.name,
      email: user.email,
      circle: user.circle ?? undefined,
      role: user.role as "admin" | "viewer",
      discipline: user.discipline,
      githubUsername: user.githubUsername ?? "",
      profile: user.profile ?? null,
    },
  });

  const userDiscipline = asDiscipline(user.discipline);
  const DisciplineIcon = DISCIPLINE_ICON[userDiscipline];

  async function onSubmit(data: EditUserInput) {
    const result = await updateUser({ id: user.id, ...data });
    if (result.success) {
      status.ok("Saved");
      router.refresh();
    } else {
      status.error(result.error);
    }
  }

  async function handleDeactivate() {
    const result = await deactivateUser({ id: user.id });
    if (result.success) {
      status.ok(`Deactivated · ${result.data.revokedCount} revoked`);
      router.refresh();
    } else {
      status.error(result.error);
    }
  }

  async function handleRevoke(assignmentId: number) {
    const result = await revokeLicense({ id: assignmentId });
    if (result.success) {
      status.ok("Revoked");
      router.refresh();
    } else {
      status.error(result.error);
    }
  }

  function resetAssignDialogState() {
    setSelectedToolId("");
    setSelectedTierId("");
    setAvailableTiers([]);
    setAssignWorkspace("");
    setAssignApiKey("");
    setShowAssignApiKey(false);
  }

  function closeAssignDialog() {
    resetAssignDialogState();
    setAssignDialogOpen(false);
  }

  async function handleToolChange(toolId: string) {
    setSelectedToolId(toolId);
    setSelectedTierId("");
    if (toolId) {
      const tool = await getToolWithTiers(Number(toolId));
      setAvailableTiers(tool?.accessTiers.filter((t) => t.isActive) ?? []);
    } else {
      setAvailableTiers([]);
    }
  }

  async function handleAssign() {
    if (!selectedToolId || !selectedTierId) return;
    setAssigning(true);
    const result = await assignLicense({
      userId: user.id,
      toolId: Number(selectedToolId),
      tierId: Number(selectedTierId),
      workspace: assignWorkspace || undefined,
      apiKey: assignApiKey || undefined,
    });
    setAssigning(false);
    if (result.success) {
      closeAssignDialog();
      router.refresh();
    } else {
      assignStatus.error(result.error);
    }
  }

  async function handleReactivate(assignment: Assignment) {
    setReactivatingId(assignment.id);
    const result = await assignLicense({
      userId: user.id,
      toolId: assignment.tool.id,
      tierId: assignment.tier.id,
    });
    setReactivatingId(null);
    if (result.success) {
      status.ok("Reactivated");
      router.refresh();
    } else {
      status.error(result.error);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{user.name}</h1>
          <p className="text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="capitalize">
            {user.role}
          </Badge>
          <Badge
            variant={user.status === "active" ? "default" : "secondary"}
          >
            {user.status}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <DisciplineIcon className="size-3" />
            {DISCIPLINE_LABEL[userDiscipline]}
          </Badge>
          {user.profile && (
            <Badge variant="outline" className="capitalize">
              {user.profile}
            </Badge>
          )}
        </div>
      </div>

      {githubProfile && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Github className="size-5" />
              GitHub Profile
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-4">
              {githubProfile.avatarUrl && (
                <Image
                  src={githubProfile.avatarUrl}
                  alt={`${githubProfile.githubLogin}'s avatar`}
                  width={64}
                  height={64}
                  className="size-16 rounded-full"
                  unoptimized
                />
              )}
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">
                    {githubProfile.name || githubProfile.githubLogin}
                  </p>
                  <span className="text-sm text-muted-foreground">
                    @{githubProfile.githubLogin}
                  </span>
                </div>
                {githubProfile.bio && (
                  <p className="text-sm text-muted-foreground">
                    {githubProfile.bio}
                  </p>
                )}
                <div className="flex items-center gap-4 pt-1">
                  {githubProfile.publicRepos != null && (
                    <span className="flex items-center gap-1 text-sm text-muted-foreground">
                      <BookOpen className="size-4" />
                      {githubProfile.publicRepos} public repos
                    </span>
                  )}
                  {githubProfile.profileUrl && (
                    <a
                      href={githubProfile.profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      <ExternalLink className="size-3" />
                      View on GitHub
                    </a>
                  )}
                </div>
                <p className="text-xs text-muted-foreground pt-1">
                  Last synced{" "}
                  {formatDate(githubProfile.lastSyncedAt)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isAdmin && user.status === "active" && (
        <Card>
          <CardHeader>
            <CardTitle>Edit User</CardTitle>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="circle"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Circle (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="discipline"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Discipline</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value ?? ""}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select a discipline" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {DISCIPLINES.map((d) => (
                            <SelectItem key={d} value={d}>
                              {DISCIPLINE_LABEL[d]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="viewer">Viewer</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="profile"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Profile</FormLabel>
                      <Select
                        onValueChange={(val) =>
                          field.onChange(val === "none" ? null : val)
                        }
                        value={field.value ?? "none"}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="boost">Boost</SelectItem>
                          <SelectItem value="maxed">Maxed</SelectItem>
                          <SelectItem value="indie">Indie</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="githubUsername"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>GitHub Username</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex gap-3">
                  <Button type="submit" disabled={form.formState.isSubmitting}>
                    Save Changes
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowResetDialog(true)}
                  >
                    <KeyRound className="mr-2 size-4" />
                    Reset Password
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive">Deactivate User</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Deactivate this user?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This will deactivate the user and revoke all their
                          active license assignments.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeactivate}>
                          Deactivate
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <StatusText status={status.status} className="self-center" />
                </div>
                <ResetPasswordDialog
                  user={user}
                  open={showResetDialog}
                  onOpenChange={setShowResetDialog}
                  onSuccess={() => router.refresh()}
                />
              </form>
            </Form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Assigned Tools</CardTitle>
          {isAdmin && user.status === "active" && (
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                resetAssignDialogState();
                setAssignDialogOpen(true);
                if (tools.length === 0) {
                  setLoadingTools(true);
                  setTools(await getTools());
                  setLoadingTools(false);
                }
              }}
            >
              <Plus className="mr-2 size-4" />
              Assign License
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {assignments.length > 0 ? (
            <div className="space-y-3">
              {assignments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <Link
                    href={`/assignments/${a.id}`}
                    className="flex-1 hover:bg-muted/50 -m-1 p-1 rounded transition-colors"
                  >
                    <p className="font-medium">{a.tool.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {a.tier.name} &bull;{" "}
                      {formatCurrency(a.costAtAssignmentCents)}/mo
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Assigned {formatDate(a.assignedAt)}
                      {a.revokedAt && ` — Revoked ${formatDate(a.revokedAt)}`}
                    </p>
                  </Link>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        a.status === "active" ? "default" : "secondary"
                      }
                    >
                      {a.status}
                    </Badge>
                    {isAdmin && a.status === "active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRevoke(a.id)}
                      >
                        Revoke
                      </Button>
                    )}
                    {isAdmin && a.status !== "active" && a.tool.status === "active" && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={reactivatingId === a.id}
                          >
                            <RotateCcw className="mr-1 size-3" />
                            {reactivatingId === a.id ? "Reactivating..." : "Reactivate"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Reactivate this license?
                            </AlertDialogTitle>
                            <AlertDialogDescription asChild>
                              <div className="space-y-2">
                                <p>
                                  This will create a new active license assignment
                                  for <strong>{user.name}</strong>:
                                </p>
                                <ul className="list-disc pl-5 text-sm">
                                  <li>Tool: <strong>{a.tool.name}</strong></li>
                                  <li>Tier: <strong>{a.tier.name}</strong></li>
                                  <li>Cost: <strong>{formatCurrency(a.costAtAssignmentCents)}/mo</strong></li>
                                </ul>
                              </div>
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleReactivate(a)}>
                              Reactivate
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No tool assignments.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Assign License Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={(open) => {
        if (!open) resetAssignDialogState();
        setAssignDialogOpen(open);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign License to {user.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Tool</label>
              <Select value={selectedToolId} onValueChange={handleToolChange} disabled={loadingTools}>
                <SelectTrigger>
                  <SelectValue placeholder={loadingTools ? "Loading tools..." : "Select tool"} />
                </SelectTrigger>
                <SelectContent>
                  {tools.filter((t) => t.status === "active").map((t) => (
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
            <div>
              <label className="text-sm font-medium">Workspace (optional)</label>
              <Input
                placeholder="e.g. team-alpha"
                maxLength={200}
                autoComplete="off"
                value={assignWorkspace}
                onChange={(e) => setAssignWorkspace(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium">API Key (optional)</label>
              <div className="flex gap-2">
                <Input
                  type={showAssignApiKey ? "text" : "password"}
                  placeholder="Enter API key"
                  maxLength={500}
                  autoComplete="new-password"
                  value={assignApiKey}
                  onChange={(e) => setAssignApiKey(e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowAssignApiKey(!showAssignApiKey)}
                >
                  {showAssignApiKey ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                  <span className="sr-only">
                    {showAssignApiKey ? "Hide" : "Show"} API key
                  </span>
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <StatusText status={assignStatus.status} className="mr-auto self-center" />
            <Button
              variant="outline"
              onClick={closeAssignDialog}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              disabled={!selectedToolId || !selectedTierId || assigning}
            >
              {assigning ? "Assigning..." : "Assign License"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AdminCostSection userId={user.id} initialData={costData} availableMonths={costAvailableMonths} />

      <Card>
        <CardHeader>
          <CardTitle>Change History</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length > 0 ? (
            <div className="space-y-3">
              {history.map((record) => (
                <div
                  key={record.id}
                  className="flex items-start gap-3 text-sm"
                >
                  <span className="text-muted-foreground whitespace-nowrap">
                    {formatDate(record.createdAt)}
                  </span>
                  <div>
                    <Badge variant="outline" className="text-xs">
                      {record.changeType}
                    </Badge>
                    {record.fieldName && (
                      <span className="ml-2">
                        <strong>{record.fieldName}</strong>
                        {record.previousValue && (
                          <>
                            {" "}
                            from{" "}
                            <code className="text-xs">
                              {record.previousValue}
                            </code>
                          </>
                        )}
                        {record.newValue && (
                          <>
                            {" "}
                            to{" "}
                            <code className="text-xs">{record.newValue}</code>
                          </>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No history yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
