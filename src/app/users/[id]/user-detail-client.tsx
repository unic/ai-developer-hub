"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { updateUser, deactivateUser } from "@/actions/users";
import { resetUserPassword } from "@/actions/invite";
import { updateUserSchema, type UpdateUserInput } from "@/lib/validators";
import { revokeLicense } from "@/actions/assignments";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { User, ChangeHistoryRecord } from "@/types";
import { Github, ExternalLink, BookOpen, KeyRound } from "lucide-react";
import { InviteLinkDialog } from "@/components/invite-link-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
  tool: { id: number; name: string };
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
}

export function UserDetailClient({
  user,
  assignments,
  history,
  isAdmin,
  githubProfile,
}: Props) {
  const router = useRouter();
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetSendEmail, setResetSendEmail] = useState(true);
  const [showInviteLink, setShowInviteLink] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");

  const form = useForm<EditUserInput>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      name: user.name,
      email: user.email,
      circle: user.circle ?? undefined,
      role: user.role as "admin" | "viewer",
      githubUsername: user.githubUsername ?? "",
      profile: user.profile ?? null,
    },
  });

  async function onSubmit(data: EditUserInput) {
    const result = await updateUser({ id: user.id, ...data });
    if (result.success) {
      toast.success("User updated");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function handleDeactivate() {
    const result = await deactivateUser({ id: user.id });
    if (result.success) {
      toast.success(
        `User deactivated. ${result.data.revokedCount} license(s) revoked.`
      );
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function handleResetPassword() {
    try {
      const result = await resetUserPassword({ userId: user.id, sendEmail: resetSendEmail });
      if (result.success) {
        setShowResetDialog(false);
        setInviteUrl(result.data.inviteUrl);
        setShowInviteLink(true);
        if (result.data.emailSent) {
          toast.success("Password reset. Invite email sent.");
        } else {
          toast.success("Password reset. Share the invite link with the user.");
        }
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("An unexpected error occurred");
    }
  }

  async function handleRevoke(assignmentId: number) {
    const result = await revokeLicense({ id: assignmentId });
    if (result.success) {
      toast.success("License revoked");
      router.refresh();
    } else {
      toast.error(result.error);
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
                    onClick={() => {
                      setResetSendEmail(true);
                      setShowResetDialog(true);
                    }}
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
                </div>
                <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset password for {user.name}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will invalidate the current password and generate a new invite link.
                        The user will not be able to sign in until they set a new password via the invite link.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="flex items-center space-x-2 py-2">
                      <Checkbox
                        id="reset-email-detail"
                        checked={resetSendEmail}
                        onCheckedChange={(checked) => setResetSendEmail(checked === true)}
                      />
                      <Label htmlFor="reset-email-detail">
                        Send invite email to {user.email}
                      </Label>
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleResetPassword}>
                        Reset Password
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <InviteLinkDialog
                  open={showInviteLink}
                  onOpenChange={setShowInviteLink}
                  inviteUrl={inviteUrl}
                  userId={user.id}
                />
              </form>
            </Form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Assigned Tools</CardTitle>
        </CardHeader>
        <CardContent>
          {assignments.length > 0 ? (
            <div className="space-y-3">
              {assignments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium">{a.tool.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {a.tier.name} &bull;{" "}
                      {formatCurrency(a.costAtAssignmentCents)}/mo
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Assigned {formatDate(a.assignedAt)}
                      {a.revokedAt && ` — Revoked ${formatDate(a.revokedAt)}`}
                    </p>
                  </div>
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
