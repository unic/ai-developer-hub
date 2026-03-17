import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">AI Developer Hub</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {result.error === "expired" && (
            <p className="text-sm text-muted-foreground">
              This link has expired. Please contact your administrator for a new
              one.
            </p>
          )}
          {result.error === "consumed" && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                This link has already been used.
              </p>
              <Link
                href="/login"
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                Go to login
              </Link>
            </div>
          )}
          {result.error === "invalid" && (
            <p className="text-sm text-muted-foreground">
              This link is not valid.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">AI Developer Hub</CardTitle>
        <CardDescription>Set up your password to get started</CardDescription>
      </CardHeader>
      <CardContent>
        <SetupPasswordForm token={token} userName={result.data.userName} />
      </CardContent>
    </Card>
  );
}
