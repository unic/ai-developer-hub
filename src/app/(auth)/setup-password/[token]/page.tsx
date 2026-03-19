import Link from "next/link";
import { Bot, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { validateInviteToken } from "@/actions/invite";
import { SetupPasswordForm } from "./setup-password-form";

export default async function SetupPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await validateInviteToken(token);

  if (!result.success) {
    return (
      <Card className="border-none shadow-lg">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 lg:hidden">
            <Bot className="size-6 text-primary" />
          </div>
          <div className="space-y-1.5">
            <CardTitle className="text-2xl font-bold tracking-tight">
              AI Developer Hub
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          {result.error === "expired" && (
            <div className="space-y-3">
              <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="size-5 text-destructive" />
              </div>
              <p className="text-sm text-muted-foreground">
                This invitation link has expired. Please contact your
                administrator for a new one.
              </p>
            </div>
          )}
          {result.error === "consumed" && (
            <div className="space-y-3">
              <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted">
                <CheckCircle2 className="size-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                This invitation link has already been used.
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link href="/login">Go to login</Link>
              </Button>
            </div>
          )}
          {result.error === "invalid" && (
            <div className="space-y-3">
              <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-destructive/10">
                <XCircle className="size-5 text-destructive" />
              </div>
              <p className="text-sm text-muted-foreground">
                This invitation link is not valid.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-none shadow-lg">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 lg:hidden">
          <Bot className="size-6 text-primary" />
        </div>
        <div className="space-y-1.5">
          <CardTitle className="text-2xl font-bold tracking-tight">
            Set your password
          </CardTitle>
          <CardDescription className="text-balance">
            Create a secure password to get started
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <SetupPasswordForm token={token} userName={result.data.userName} />
      </CardContent>
    </Card>
  );
}
