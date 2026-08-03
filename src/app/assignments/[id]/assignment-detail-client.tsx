"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { format, parseISO } from "date-fns";
import {
  revealApiKey,
  updateAssignment,
  addAssignmentComment,
} from "@/actions/assignments";
import { getToolWithTiers } from "@/actions/tools";
import {
  updateAssignmentSchema,
  type UpdateAssignmentInput,
} from "@/lib/validators";
import { formatCurrency, cn, formatDateOnly, formatDate } from "@/lib/utils";
import type { AccessTier, UserDiscipline } from "@/types";
import { DISCIPLINE_ICON, DISCIPLINE_LABEL, asDiscipline } from "@/lib/disciplines";
import { SYNC_MANAGED_TIER_ERROR } from "@/lib/assignments/tier-change";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
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
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Eye,
  EyeOff,
  Copy,
  MessageSquare,
  Clock,
  ArrowLeft,
  CalendarIcon,
} from "lucide-react";

interface AssignmentData {
  id: number;
  status: string;
  costAtAssignmentCents: number;
  assignedAt: string | null;
  revokedAt: string | null;
  workspace: string | null;
  user: { id: number; name: string; discipline: UserDiscipline };
  tool: { id: number; name: string };
  tier: { id: number; name: string };
  hasApiKey: boolean;
  maskedApiKey: string | null;
}

interface CommentData {
  id: number;
  body: string;
  createdAt: string;
  author: { name: string };
}

interface TierHistoryEntry {
  id: number;
  previousTierName: string | null;
  newTierName: string | null;
  changedByName: string;
  createdAt: string;
}

interface Props {
  assignment: AssignmentData;
  comments: CommentData[];
  isAdmin: boolean;
  // Gated on the tool, not assignment.source (spec 042) — see
  // isSyncManagedTool in src/lib/assignments/sync-authority.ts. Only the tier
  // control is affected; workspace, API key and assigned-date stay editable.
  isSyncManaged: boolean;
  tierHistory: TierHistoryEntry[];
}

export function AssignmentDetailClient({
  assignment,
  comments,
  isAdmin,
  isSyncManaged,
  tierHistory,
}: Props) {
  const router = useRouter();
  const detailStatus = useInlineStatus();
  const commentStatus = useInlineStatus();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  // Edit form state
  const [tiers, setTiers] = useState<AccessTier[]>([]);
  const [loadingTiers, setLoadingTiers] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const form = useForm<UpdateAssignmentInput>({
    resolver: zodResolver(updateAssignmentSchema),
    defaultValues: {
      id: assignment.id,
      tierId: assignment.tier.id,
      assignedAt: assignment.assignedAt
        ? formatDateOnly(new Date(assignment.assignedAt))
        : undefined,
      workspace: assignment.workspace ?? "",
      apiKey: "",
    },
  });

  const loadTiers = useCallback(async () => {
    setLoadingTiers(true);
    try {
      const tool = await getToolWithTiers(assignment.tool.id);
      setTiers(tool?.accessTiers.filter((t) => t.isActive) ?? []);
    } catch {
      detailStatus.error("Failed to load tiers");
    } finally {
      setLoadingTiers(false);
    }
    // detailStatus is now a memoized object (stable unless its status changes),
    // so this callback no longer churns every render and the mount effect runs
    // once instead of looping.
  }, [assignment.tool.id, detailStatus]);

  useEffect(() => {
    if (isAdmin && assignment.status === "active") {
      loadTiers();
    }
  }, [isAdmin, assignment.status, loadTiers]);

  async function onSubmit(data: UpdateAssignmentInput) {
    const dirtyFields = form.formState.dirtyFields;
    const payload: UpdateAssignmentInput = {
      id: data.id,
      tierId: data.tierId,
      assignedAt: data.assignedAt,
      workspace: data.workspace,
      // Only include apiKey when the field was explicitly touched to avoid
      // unintended clearing of existing keys (empty string = clear)
      apiKey: dirtyFields.apiKey ? data.apiKey : undefined,
    };

    const result = await updateAssignment(payload);
    if (result.success) {
      if (result.warning) {
        detailStatus.info(result.warning);
      } else {
        detailStatus.ok("Saved");
      }
      form.reset({ ...payload, apiKey: "" });
      router.refresh();
    } else {
      detailStatus.error(result.error);
    }
  }

  async function handleRevealApiKey() {
    if (revealedKey) {
      setRevealedKey(null);
      return;
    }

    setRevealing(true);
    try {
      const result = await revealApiKey(assignment.id);
      if (result.success) {
        setRevealedKey(result.data.plaintext);
      } else {
        detailStatus.error(result.error);
      }
    } catch {
      detailStatus.error("Failed to reveal API key");
    } finally {
      setRevealing(false);
    }
  }

  async function handleCopyApiKey() {
    const key = revealedKey;
    if (!key) {
      detailStatus.error("Reveal the key first");
      return;
    }
    try {
      await navigator.clipboard.writeText(key);
      detailStatus.ok("Copied");
    } catch {
      detailStatus.error("Copy failed");
    }
  }

  async function handleAddComment() {
    if (!commentBody.trim()) return;

    setSubmittingComment(true);
    try {
      const result = await addAssignmentComment({
        assignmentId: assignment.id,
        body: commentBody.trim(),
      });
      if (result.success) {
        commentStatus.ok("Added");
        setCommentBody("");
        router.refresh();
      } else {
        commentStatus.error(result.error);
      }
    } catch {
      commentStatus.error("Failed to add comment");
    } finally {
      setSubmittingComment(false);
    }
  }

  const displayedKey = revealedKey ?? assignment.maskedApiKey ?? "";

  return (
    <div className="space-y-6">
      {/* Back link + Header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/assignments">
            <ArrowLeft className="mr-2 size-4" />
            Back to Assignments
          </Link>
        </Button>
        <h1 className="text-3xl font-medium tracking-tight text-ink">
          <Link
            href={`/users/${assignment.user.id}`}
            className="hover:underline"
          >
            {assignment.user.name}
          </Link>{" "}
          &rarr; {assignment.tool.name} at {assignment.tier.name}
        </h1>
        <p className="text-muted-foreground flex items-center gap-2">
          <span>Assignment #{assignment.id}</span>
          <span aria-hidden="true">&middot;</span>
          <span className="inline-flex items-center gap-1">
            {(() => {
              const d = asDiscipline(assignment.user.discipline);
              const Icon = DISCIPLINE_ICON[d];
              return (
                <>
                  <Icon className="size-3.5" />
                  {DISCIPLINE_LABEL[d]}
                </>
              );
            })()}
          </span>
        </p>
      </div>

      {/* Unified Assignment Details Card */}
      <Card>
        <CardHeader>
          <CardTitle>Assignment Details</CardTitle>
          <CardDescription>
            License assignment information and configuration
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isAdmin && assignment.status === "active" ? (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Status */}
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">
                      Status
                    </p>
                    <Badge variant="default">Active</Badge>
                  </div>

                  {/* Tier (editable, unless sync-managed) */}
                  <FormField
                    control={form.control}
                    name="tierId"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-2">
                          <FormLabel className="text-sm font-medium text-muted-foreground">
                            Tier
                          </FormLabel>
                          {isSyncManaged && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className="cursor-default text-xs text-muted-foreground"
                                >
                                  Managed by sync
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                {SYNC_MANAGED_TIER_ERROR}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <Select
                          value={String(field.value)}
                          onValueChange={(val) => field.onChange(Number(val))}
                          disabled={
                            loadingTiers || tiers.length === 0 || isSyncManaged
                          }
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={
                                  loadingTiers
                                    ? "Loading tiers..."
                                    : "Select tier"
                                }
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {tiers.map((t) => (
                              <SelectItem key={t.id} value={String(t.id)}>
                                {t.name} &mdash;{" "}
                                {formatCurrency(t.monthlyCostCents)}/mo
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                        {!isSyncManaged && (
                          <p className="text-xs text-muted-foreground">
                            Changing tier re-prices the current month and
                            restates already-closed budget periods at the new
                            price.
                          </p>
                        )}
                      </FormItem>
                    )}
                  />

                  {/* Cost (read-only) */}
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">
                      Cost per Month
                    </p>
                    <p className="text-sm">
                      {formatCurrency(assignment.costAtAssignmentCents)}
                    </p>
                  </div>

                  {/* Assigned Date (editable) */}
                  <FormField
                    control={form.control}
                    name="assignedAt"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel className="text-sm font-medium text-muted-foreground">
                          Assigned Date
                        </FormLabel>
                        <Popover
                          open={datePickerOpen}
                          onOpenChange={setDatePickerOpen}
                        >
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                className={cn(
                                  "w-full justify-start text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                              >
                                <CalendarIcon className="mr-2 size-4" />
                                {field.value
                                  ? format(parseISO(field.value), "PPP")
                                  : "Pick a date"}
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-auto p-0"
                            align="start"
                          >
                            <Calendar
                              mode="single"
                              captionLayout="dropdown"
                              selected={
                                field.value
                                  ? parseISO(field.value)
                                  : undefined
                              }
                              onSelect={(date) => {
                                if (date) {
                                  field.onChange(formatDateOnly(date));
                                }
                                setDatePickerOpen(false);
                              }}
                              disabled={(date) => date > new Date()}
                              defaultMonth={
                                field.value
                                  ? parseISO(field.value)
                                  : undefined
                              }
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Workspace (editable) */}
                  <FormField
                    control={form.control}
                    name="workspace"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-muted-foreground">
                          Workspace
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g. team-alpha"
                            maxLength={200}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* API Key (editable) */}
                <Separator />
                <div className="space-y-2">
                  {assignment.hasApiKey && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-muted-foreground">
                        Current API Key
                      </p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm font-mono">
                          {displayedKey}
                        </code>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={handleRevealApiKey}
                          disabled={revealing}
                          title={
                            revealedKey ? "Hide API key" : "Reveal API key"
                          }
                        >
                          {revealedKey ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                          <span className="sr-only">
                            {revealedKey ? "Hide" : "Reveal"} API key
                          </span>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={handleCopyApiKey}
                          disabled={!revealedKey}
                          title="Copy API key"
                        >
                          <Copy className="size-4" />
                          <span className="sr-only">Copy API key</span>
                        </Button>
                      </div>
                    </div>
                  )}
                  <FormField
                    control={form.control}
                    name="apiKey"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {assignment.hasApiKey
                            ? "Replace API Key"
                            : "API Key"}
                        </FormLabel>
                        <div className="flex gap-2">
                          <FormControl>
                            <Input
                              type={showApiKey ? "text" : "password"}
                              placeholder={
                                assignment.hasApiKey
                                  ? "Enter new key to replace existing"
                                  : "Enter API key"
                              }
                              {...field}
                            />
                          </FormControl>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowApiKey(!showApiKey)}
                          >
                            {showApiKey ? (
                              <EyeOff className="size-4" />
                            ) : (
                              <Eye className="size-4" />
                            )}
                            <span className="sr-only">
                              {showApiKey ? "Hide" : "Show"} API key input
                            </span>
                          </Button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Button
                    type="submit"
                    disabled={form.formState.isSubmitting}
                  >
                    {form.formState.isSubmitting
                      ? "Saving..."
                      : "Save Changes"}
                  </Button>
                  <StatusText status={detailStatus.status} />
                </div>
              </form>
            </Form>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Status */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    Status
                  </p>
                  <Badge
                    variant={
                      assignment.status === "active" ? "default" : "secondary"
                    }
                  >
                    {assignment.status === "active" ? "Active" : "Inactive"}
                  </Badge>
                </div>

                {/* Tier */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    Tier
                  </p>
                  <p className="text-sm">{assignment.tier.name}</p>
                </div>

                {/* Cost */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    Cost per Month
                  </p>
                  <p className="text-sm">
                    {formatCurrency(assignment.costAtAssignmentCents)}
                  </p>
                </div>

                {/* Assigned date */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    Assigned Date
                  </p>
                  <p className="text-sm">
                    {assignment.assignedAt
                      ? format(new Date(assignment.assignedAt), "PPP")
                      : "\u2014"}
                  </p>
                </div>

                {/* Revoked date (only if inactive) */}
                {assignment.revokedAt && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">
                      Revoked Date
                    </p>
                    <p className="text-sm">
                      {format(new Date(assignment.revokedAt), "PPP")}
                    </p>
                  </div>
                )}

                {/* Workspace */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    Workspace
                  </p>
                  <p className="text-sm">
                    {assignment.workspace || "\u2014"}
                  </p>
                </div>
              </div>

              {/* API Key display section */}
              {assignment.hasApiKey && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">
                      API Key
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded-md border bg-muted px-3 py-2 text-sm font-mono">
                        {displayedKey}
                      </code>
                      {isAdmin && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={handleRevealApiKey}
                            disabled={revealing}
                            title={
                              revealedKey
                                ? "Hide API key"
                                : "Reveal API key"
                            }
                          >
                            {revealedKey ? (
                              <EyeOff className="size-4" />
                            ) : (
                              <Eye className="size-4" />
                            )}
                            <span className="sr-only">
                              {revealedKey ? "Hide" : "Reveal"} API key
                            </span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={handleCopyApiKey}
                            disabled={!revealedKey}
                            title="Copy API key"
                          >
                            <Copy className="size-4" />
                            <span className="sr-only">Copy API key</span>
                          </Button>
                        </>
                      )}
                    </div>
                    {isAdmin && <StatusText status={detailStatus.status} />}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Tier timeline (spec 042) — the audit trail change_history already
              keeps; assigned_at alone can't answer "since when is she on
              Premium Seat?" once a tier change mutates the row in place. */}
          {tierHistory.length > 0 && (
            <>
              <Separator className="my-4" />
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-muted-foreground">
                  Tier History
                </p>
                <ul className="space-y-1">
                  {tierHistory.map((entry) => (
                    <li
                      key={entry.id}
                      className="text-sm text-muted-foreground"
                    >
                      {entry.previousTierName ?? "—"} &rarr;{" "}
                      {entry.newTierName ?? "—"} &middot;{" "}
                      {formatDate(entry.createdAt)} &middot;{" "}
                      {entry.changedByName}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Comments Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="size-5" />
            Comments
            <Badge variant="secondary">{comments.length}</Badge>
          </CardTitle>
          <CardDescription>
            Discussion and notes for this assignment
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Comments list */}
          {comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No comments yet.
            </p>
          ) : (
            <div className="space-y-4">
              {comments.map((comment) => (
                <div key={comment.id} className="space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{comment.author.name}</span>
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="size-3" />
                      {format(new Date(comment.createdAt), "PPP 'at' p")}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
                  {comment !== comments[comments.length - 1] && (
                    <Separator className="mt-3" />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add comment form (admin only) */}
          {isAdmin && (
            <>
              <Separator />
              <div className="space-y-3">
                <Textarea
                  placeholder="Add a comment..."
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  maxLength={2000}
                  rows={3}
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {commentBody.length}/2000 characters
                  </p>
                  <div className="flex items-center gap-3">
                    <StatusText status={commentStatus.status} />
                    <Button
                      onClick={handleAddComment}
                      disabled={
                        !commentBody.trim() || submittingComment
                      }
                    >
                      {submittingComment ? "Adding..." : "Add Comment"}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
