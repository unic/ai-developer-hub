"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { updateUser, deactivateUser } from "@/actions/users";
import { updateUserSchema, type UpdateUserInput } from "@/lib/validators";
import { revokeLicense } from "@/actions/assignments";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { User, ChangeHistoryRecord } from "@/types";
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

interface Props {
  user: User;
  assignments: Assignment[];
  history: ChangeHistoryRecord[];
  isAdmin: boolean;
}

export function UserDetailClient({
  user,
  assignments,
  history,
  isAdmin,
}: Props) {
  const router = useRouter();

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
