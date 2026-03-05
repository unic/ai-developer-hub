"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { format } from "date-fns";
import { revealApiKey, updateAssignment, addAssignmentComment } from "@/actions/assignments";
import { formatCurrency } from "@/lib/utils";
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
import {
  Eye,
  EyeOff,
  Copy,
  MessageSquare,
  Clock,
  ArrowLeft,
} from "lucide-react";

interface AssignmentData {
  id: number;
  status: string;
  costAtAssignmentCents: number;
  assignedAt: string | null;
  revokedAt: string | null;
  workspace: string | null;
  user: { id: number; name: string };
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

interface Props {
  assignment: AssignmentData;
  comments: CommentData[];
  isAdmin: boolean;
}

export function AssignmentDetailClient({
  assignment,
  comments,
  isAdmin,
}: Props) {
  const router = useRouter();
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savingApiKey, setSavingApiKey] = useState(false);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);

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
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to reveal API key");
    } finally {
      setRevealing(false);
    }
  }

  async function handleCopyApiKey() {
    const key = revealedKey;
    if (!key) {
      toast.error("Reveal the API key first to copy it");
      return;
    }
    try {
      await navigator.clipboard.writeText(key);
      toast.success("API key copied to clipboard");
    } catch {
      toast.error("Failed to copy to clipboard");
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
        toast.success("Comment added");
        setCommentBody("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to add comment");
    } finally {
      setSubmittingComment(false);
    }
  }

  async function handleSaveApiKey() {
    if (!apiKeyInput.trim()) return;
    setSavingApiKey(true);
    try {
      const result = await updateAssignment({
        id: assignment.id,
        apiKey: apiKeyInput.trim(),
      });
      if (result.success) {
        toast.success("API key saved");
        setApiKeyInput("");
        setShowApiKeyInput(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to save API key");
    } finally {
      setSavingApiKey(false);
    }
  }

  async function handleClearApiKey() {
    setSavingApiKey(true);
    try {
      const result = await updateAssignment({
        id: assignment.id,
        apiKey: "",
      });
      if (result.success) {
        toast.success("API key cleared");
        setRevealedKey(null);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to clear API key");
    } finally {
      setSavingApiKey(false);
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
        <h1 className="text-3xl font-bold">
          {assignment.user.name} &rarr; {assignment.tool.name} at{" "}
          {assignment.tier.name}
        </h1>
        <p className="text-muted-foreground">
          Assignment #{assignment.id}
        </p>
      </div>

      {/* Detail Card */}
      <Card>
        <CardHeader>
          <CardTitle>Assignment Details</CardTitle>
          <CardDescription>
            License assignment information and configuration
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
              <p className="text-sm font-medium text-muted-foreground">Tier</p>
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

          {/* API Key section */}
          <Separator />
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              API Key
            </p>
            {assignment.hasApiKey ? (
              <div className="space-y-2">
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
                        title={revealedKey ? "Hide API key" : "Reveal API key"}
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
                {isAdmin && assignment.status === "active" && (
                  <div className="flex flex-wrap items-center gap-2">
                    {showApiKeyInput ? (
                      <>
                        <Input
                          type="password"
                          placeholder="Enter new API key"
                          value={apiKeyInput}
                          onChange={(e) => setApiKeyInput(e.target.value)}
                          className="max-w-xs"
                        />
                        <Button
                          size="sm"
                          onClick={handleSaveApiKey}
                          disabled={savingApiKey || !apiKeyInput.trim()}
                        >
                          {savingApiKey ? "Saving..." : "Update"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setShowApiKeyInput(false);
                            setApiKeyInput("");
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowApiKeyInput(true)}
                        >
                          Update API Key
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleClearApiKey}
                          disabled={savingApiKey}
                        >
                          Clear API Key
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">No API key set</p>
                {isAdmin && assignment.status === "active" && (
                  <div className="flex items-center gap-2">
                    <Input
                      type="password"
                      placeholder="Enter API key"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      className="max-w-xs"
                    />
                    <Button
                      size="sm"
                      onClick={handleSaveApiKey}
                      disabled={savingApiKey || !apiKeyInput.trim()}
                    >
                      {savingApiKey ? "Saving..." : "Save"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
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
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
