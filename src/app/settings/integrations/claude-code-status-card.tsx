import { CircleAlert, BrainCircuit } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

interface ClaudeCodeStatusCardProps {
  connected: boolean;
  workspaceName: string | null;
  lastCheckedAt: string; // ISO datetime
}

export function ClaudeCodeStatusCard({
  connected,
  workspaceName,
  lastCheckedAt,
}: ClaudeCodeStatusCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="size-5" />
            Claude Code (Anthropic API)
          </CardTitle>
          {connected ? (
            <Badge variant="default">Connected</Badge>
          ) : (
            <Badge variant="secondary">
              <CircleAlert className="size-3 mr-1" />
              Not Configured
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          {workspaceName && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Workspace</dt>
              <dd className="font-medium">{workspaceName}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Last checked</dt>
            <dd className="font-medium">{formatDateTime(lastCheckedAt)}</dd>
          </div>
          {!connected && (
            <p className="text-xs text-muted-foreground pt-2">
              Set the <code>ANTHROPIC_ADMIN_API_KEY</code> environment variable to enable
              Anthropic API cost tracking.
            </p>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
