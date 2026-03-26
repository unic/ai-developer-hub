"use client";

import { useState } from "react";
import { Loader2, Send, Copy, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { JsonViewer } from "@/components/ui/json-viewer";
import {
  previewProfileApi,
  type ApiPreviewResponse,
} from "@/actions/profile-api-preview";
import { apiPreviewEmailSchema, apiPreviewMonthSchema } from "@/lib/validators";

export function ApiPreviewClient({ isConfigured }: { isConfigured: boolean }) {
  const [email, setEmail] = useState("");
  const [month, setMonth] = useState("");
  const [emailError, setEmailError] = useState("");
  const [monthError, setMonthError] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ApiPreviewResponse | null>(null);
  const [copied, setCopied] = useState(false);

  function validateEmail(value: string) {
    if (!value) {
      setEmailError("Email is required");
      return false;
    }
    const result = apiPreviewEmailSchema.safeParse(value);
    setEmailError(result.success ? "" : result.error.errors[0]?.message ?? "Invalid email");
    return result.success;
  }

  function validateMonth(value: string) {
    if (!value) {
      setMonthError("");
      return true;
    }
    const result = apiPreviewMonthSchema.safeParse(value);
    setMonthError(result.success ? "" : result.error.errors[0]?.message ?? "Invalid month");
    return result.success;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const emailValid = validateEmail(email);
    const monthValid = validateMonth(month);
    if (!emailValid || !monthValid) return;

    setLoading(true);
    setResponse(null);
    try {
      const result = await previewProfileApi({
        email,
        month: month || undefined,
      });
      if (result.success) {
        setResponse(result.data);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("Failed to send request");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!response) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(response.body, null, 2)
      );
      setCopied(true);
      toast.success("JSON copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  }

  const isSuccess = response && response.status >= 200 && response.status < 300;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile API</CardTitle>
        <CardDescription>
          Send a request to the profile API endpoint and inspect the response.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!isConfigured && (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" />
            <AlertDescription>
              <code>PROFILE_API_SECRET</code> is not configured. The API preview
              cannot send requests until this environment variable is set.
            </AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="preview-email">Email</Label>
              <Input
                id="preview-email"
                type="email"
                placeholder="user@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) validateEmail(e.target.value);
                }}
                onBlur={() => email && validateEmail(email)}
                disabled={!isConfigured || loading}
                aria-invalid={!!emailError}
                aria-describedby={emailError ? "email-error" : undefined}
              />
              {emailError && (
                <p id="email-error" className="text-sm text-destructive">
                  {emailError}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="preview-month">Month (optional)</Label>
              <Input
                id="preview-month"
                type="text"
                placeholder="YYYY-MM"
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value);
                  if (monthError) validateMonth(e.target.value);
                }}
                onBlur={() => month && validateMonth(month)}
                disabled={!isConfigured || loading}
                aria-invalid={!!monthError}
                aria-describedby={monthError ? "month-error" : undefined}
              />
              {monthError && (
                <p id="month-error" className="text-sm text-destructive">
                  {monthError}
                </p>
              )}
            </div>
          </div>
          <Button type="submit" disabled={!isConfigured || loading}>
            {loading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Send className="mr-2 size-4" />
            )}
            {loading ? "Sending..." : "Send Request"}
          </Button>
        </form>

        {response && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={isSuccess ? "default" : "destructive"}>
                {response.status} {response.statusText}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {response.responseTimeMs}ms
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="ml-auto"
              >
                {copied ? (
                  <Check className="mr-1.5 size-3.5" />
                ) : (
                  <Copy className="mr-1.5 size-3.5" />
                )}
                {copied ? "Copied" : "Copy JSON"}
              </Button>
            </div>
            <JsonViewer data={response.body} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
