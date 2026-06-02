"use client";

import { useState, useTransition } from "react";
import { Github, Unplug, KeyRound } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { StatusText, useInlineStatus } from "@/components/ui/status-text";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  validateGitHubToken,
  connectGitHubOrg,
  disconnectGitHubOrg,
  updateGitHubToken,
} from "@/actions/github";
import type { GitHubConnectionStatus } from "@/types";

interface ConnectionData {
  id: number;
  orgLogin: string;
  orgAvatarUrl: string | null;
  status: GitHubConnectionStatus;
  connectedAt: Date;
  lastSyncAt: Date | null;
}

interface Props {
  initialConnection: ConnectionData | null;
}

export function GitHubIntegrationClient({ initialConnection }: Props) {
  const [connection, setConnection] = useState(initialConnection);
  const [isPending, startTransition] = useTransition();
  const status = useInlineStatus();

  // Token validation state
  const [token, setToken] = useState("");
  const [orgs, setOrgs] = useState<
    Array<{ login: string; id: number; avatarUrl: string | null; description: string | null }>
  >([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [isValidated, setIsValidated] = useState(false);

  // Update token state
  const [showUpdateToken, setShowUpdateToken] = useState(false);
  const [updateToken, setUpdateTokenValue] = useState("");

  function handleValidateToken() {
    startTransition(async () => {
      const result = await validateGitHubToken({ token });
      if (result.success) {
        setOrgs(result.data.organizations);
        setIsValidated(true);
        if (result.data.organizations.length === 1) {
          setSelectedOrg(result.data.organizations[0].login);
        }
        status.ok(`Token valid · ${result.data.organizations.length} org(s)`);
      } else {
        status.error(result.error);
        setIsValidated(false);
        setOrgs([]);
      }
    });
  }

  function handleConnect() {
    const org = orgs.find((o) => o.login === selectedOrg);
    if (!org) return;

    startTransition(async () => {
      const result = await connectGitHubOrg({
        token,
        orgLogin: org.login,
        orgId: org.id,
      });
      if (result.success) {
        setConnection({
          id: result.data.connectionId,
          orgLogin: org.login,
          orgAvatarUrl: org.avatarUrl,
          status: "active",
          connectedAt: new Date(),
          lastSyncAt: null,
        });
        setToken("");
        setIsValidated(false);
        setOrgs([]);
        status.ok(`Connected to ${org.login}`);
      } else {
        status.error(result.error);
      }
    });
  }

  function handleDisconnect() {
    startTransition(async () => {
      const result = await disconnectGitHubOrg();
      if (result.success) {
        setConnection(null);
        status.ok("Disconnected");
      } else {
        status.error(result.error);
      }
    });
  }

  function handleUpdateToken() {
    startTransition(async () => {
      const result = await updateGitHubToken({ token: updateToken });
      if (result.success) {
        setShowUpdateToken(false);
        setUpdateTokenValue("");
        status.ok("Token updated");
      } else {
        status.error(result.error);
      }
    });
  }

  // --- Render ---

  if (!connection) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="size-5" />
            GitHub Organization
          </CardTitle>
          <CardDescription>
            Connect your GitHub organization to enrich user profiles with GitHub
            data.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="github-token">Personal Access Token (Classic)</Label>
            <Input
              id="github-token"
              type="password"
              placeholder="ghp_..."
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setIsValidated(false);
                setOrgs([]);
              }}
              aria-describedby="token-help"
            />
            <p id="token-help" className="text-xs text-muted-foreground">
              Requires <code>read:org</code>, <code>read:user</code>, and{" "}
              <code>manage_billing:copilot</code> scopes (the last for Copilot
              billing and usage metrics).
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleValidateToken}
              disabled={!token || isPending}
              variant="outline"
            >
              {isPending ? "Validating..." : "Validate Token"}
            </Button>
            <StatusText status={status.status} />
          </div>

          {isValidated && orgs.length > 0 && (
            <div className="space-y-3 pt-2 border-t">
              <div className="space-y-2">
                <Label htmlFor="org-select">Select Organization</Label>
                <Select value={selectedOrg} onValueChange={setSelectedOrg}>
                  <SelectTrigger id="org-select" aria-label="Select GitHub organization">
                    <SelectValue placeholder="Choose an organization" />
                  </SelectTrigger>
                  <SelectContent>
                    {orgs.map((org) => (
                      <SelectItem key={org.login} value={org.login}>
                        {org.login}
                        {org.description ? ` — ${org.description}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleConnect}
                disabled={!selectedOrg || isPending}
              >
                {isPending ? "Connecting..." : "Connect Organization"}
              </Button>
            </div>
          )}

          {isValidated && orgs.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No organizations found for this token.
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Connected state
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Github className="size-5" />
            {connection.orgLogin}
          </CardTitle>
          <Badge variant="default">Connected</Badge>
        </div>
        <CardDescription>
          Connected {formatDate(connection.connectedAt)}
          {connection.lastSyncAt && (
            <>
              {" "}
              · Last synced{" "}
              {formatDate(connection.lastSyncAt)}
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowUpdateToken(!showUpdateToken)}
          >
            <KeyRound className="size-4 mr-2" />
            Update Token
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" disabled={isPending}>
                <Unplug className="size-4 mr-2" />
                Disconnect
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect GitHub Organization?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove the connection credentials. Previously
                  enriched user data will be retained.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDisconnect}>
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <StatusText status={status.status} />
        </div>

        {/* Update Token Form */}
        {showUpdateToken && (
          <div className="mt-4 p-4 border rounded-lg space-y-3">
            <Label htmlFor="update-token">New Personal Access Token</Label>
            <Input
              id="update-token"
              type="password"
              placeholder="ghp_..."
              value={updateToken}
              onChange={(e) => setUpdateTokenValue(e.target.value)}
              aria-describedby="update-token-help"
            />
            <p
              id="update-token-help"
              className="text-xs text-muted-foreground"
            >
              Requires <code>read:org</code>, <code>read:user</code>, and{" "}
              <code>manage_billing:copilot</code> scopes (the last for Copilot
              billing and usage metrics).
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleUpdateToken}
                disabled={!updateToken || isPending}
              >
                {isPending ? "Updating..." : "Save Token"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowUpdateToken(false);
                  setUpdateTokenValue("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
