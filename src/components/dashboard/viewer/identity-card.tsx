import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { ProfileData } from "@/types";
import type { ViewerSyncStatus } from "@/actions/dashboard";

interface IdentityCardProps {
  profile: ProfileData["user"];
  toolCount: number;
  activeLicenseCount: number;
  sync: ViewerSyncStatus;
  hasApiKey: boolean;
}

export function IdentityCard({
  profile,
  toolCount,
  activeLicenseCount,
  sync,
  hasApiKey,
}: IdentityCardProps) {
  const initials = (profile.name || "")
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/15 text-base font-semibold text-primary">
            {initials || "?"}
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">
              {profile.name || profile.email}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {profile.email}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="capitalize">
                {profile.role}
              </Badge>
              {profile.profile && (
                <Badge variant="default" className="capitalize">
                  {profile.profile}
                </Badge>
              )}
              {profile.circle && (
                <Badge variant="secondary">{profile.circle}</Badge>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t pt-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Tools assigned
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {toolCount}
            </p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Active licenses
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {activeLicenseCount}
            </p>
          </div>
        </div>

        <SyncCallout sync={sync} hasApiKey={hasApiKey} />
      </CardContent>
    </Card>
  );
}

function SyncCallout({
  sync,
  hasApiKey,
}: {
  sync: ViewerSyncStatus;
  hasApiKey: boolean;
}) {
  if (!hasApiKey) {
    return (
      <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <AlertCircle className="mt-[2px] size-4 shrink-0" aria-hidden />
        <p>
          No Claude API key configured. Ask your lead to grant one if you need
          usage tracking.
        </p>
      </div>
    );
  }

  if (!sync.hasRow || !sync.lastSyncedAt) {
    return (
      <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <AlertCircle className="mt-[2px] size-4 shrink-0" aria-hidden />
        <p>Anthropic data · awaiting first sync.</p>
      </div>
    );
  }

  if (sync.isStale) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-warning px-3 py-2 text-xs text-warning">
        <AlertCircle className="mt-[2px] size-4 shrink-0" aria-hidden />
        <p>
          Anthropic data is stale — last sync{" "}
          {formatDistanceToNow(new Date(sync.lastSyncedAt), { addSuffix: true })}.
          {sync.errorMessage ? ` (${sync.errorMessage})` : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-success px-3 py-2 text-xs text-success">
      <Check className="mt-[2px] size-4 shrink-0" aria-hidden />
      <p>
        Claude API key configured · Anthropic data synced{" "}
        {formatDistanceToNow(new Date(sync.lastSyncedAt), { addSuffix: true })}.
      </p>
    </div>
  );
}
