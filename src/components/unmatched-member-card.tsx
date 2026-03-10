"use client";

import Image from "next/image";
import { ExternalLink, UserCheck, UserPlus, SkipForward, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import type {
  SyncUnmatchedMember,
  MatchSuggestion,
  PendingResolution,
} from "@/types";

interface UnmatchedMemberCardProps {
  member: SyncUnmatchedMember;
  suggestions: MatchSuggestion[];
  resolution: PendingResolution | undefined;
  onResolve: (resolution: PendingResolution) => void;
  onUndo: (githubLogin: string) => void;
  /** Render slot for match action (UserSearchCombobox) */
  matchActionSlot?: React.ReactNode;
  /** Render slot for create action (InlineUserForm) */
  createActionSlot?: React.ReactNode;
  /** Whether match action is expanded */
  isMatchExpanded?: boolean;
  /** Whether create action is expanded */
  isCreateExpanded?: boolean;
  onExpandMatch?: () => void;
  onExpandCreate?: () => void;
  onCollapse?: () => void;
}

export function UnmatchedMemberCard({
  member,
  suggestions,
  resolution,
  onResolve,
  onUndo,
  matchActionSlot,
  createActionSlot,
  isMatchExpanded,
  isCreateExpanded,
  onExpandMatch,
  onExpandCreate,
  onCollapse,
}: UnmatchedMemberCardProps) {
  const isResolved = !!resolution;

  return (
    <Card className={isResolved ? "opacity-60" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {member.githubAvatarUrl && (
              <Image
                src={member.githubAvatarUrl}
                alt=""
                width={40}
                height={40}
                className="size-10 rounded-full shrink-0"
                unoptimized
              />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="font-semibold text-sm truncate">
                  {member.githubLogin}
                </h4>
                <a
                  href={member.githubProfileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  aria-label={`View ${member.githubLogin} on GitHub`}
                >
                  <ExternalLink className="size-3.5" />
                </a>
              </div>
              {member.githubName && (
                <p className="text-xs text-muted-foreground truncate">
                  {member.githubName}
                </p>
              )}
              {member.githubEmail && (
                <p className="text-xs text-muted-foreground truncate">
                  {member.githubEmail}
                </p>
              )}
            </div>
          </div>

          {/* Resolution badge */}
          {resolution && (
            <div className="flex items-center gap-1.5 shrink-0">
              <ResolutionBadge resolution={resolution} />
              <Button
                variant="ghost"
                size="icon"
                className="size-6"
                onClick={() => {
                  onUndo(member.githubLogin);
                  onCollapse?.();
                }}
                aria-label="Undo resolution"
              >
                <Undo2 className="size-3.5" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0 space-y-3">
        {/* Suggestions */}
        {!isResolved && suggestions.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Suggested matches
            </p>
            {suggestions.map((s) => (
              <button
                key={s.userId}
                type="button"
                className="flex items-center justify-between w-full rounded-md border px-3 py-1.5 text-left text-xs hover:bg-accent transition-colors"
                onClick={() =>
                  onResolve({
                    type: "match",
                    githubLogin: member.githubLogin,
                    userId: s.userId,
                    userName: s.userName,
                  })
                }
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium truncate">{s.userName}</span>
                  <span className="text-muted-foreground truncate">
                    {s.userEmail}
                  </span>
                  {s.userStatus === "inactive" && (
                    <Badge variant="outline" className="text-[10px] px-1 py-0">
                      inactive
                    </Badge>
                  )}
                </div>
                <span className="text-muted-foreground shrink-0 ml-2">
                  {s.reason} ({Math.round(s.score * 100)}%)
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Action buttons */}
        {!isResolved && !isMatchExpanded && !isCreateExpanded && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={onExpandMatch}
            >
              <UserCheck className="size-3.5 mr-1.5" />
              Match
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={onExpandCreate}
            >
              <UserPlus className="size-3.5 mr-1.5" />
              Create
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() =>
                onResolve({ type: "skip", githubLogin: member.githubLogin })
              }
            >
              <SkipForward className="size-3.5 mr-1.5" />
              Skip
            </Button>
          </div>
        )}

        {/* Expanded match action slot */}
        {!isResolved && isMatchExpanded && matchActionSlot}

        {/* Expanded create action slot */}
        {!isResolved && isCreateExpanded && createActionSlot}
      </CardContent>
    </Card>
  );
}

function ResolutionBadge({ resolution }: { resolution: PendingResolution }) {
  switch (resolution.type) {
    case "match":
      return (
        <Badge variant="default" className="text-xs">
          <UserCheck className="size-3 mr-1" />
          Matched to {resolution.userName}
        </Badge>
      );
    case "create":
      return (
        <Badge variant="secondary" className="text-xs">
          <UserPlus className="size-3 mr-1" />
          New user: {resolution.name}
        </Badge>
      );
    case "skip":
      return (
        <Badge variant="outline" className="text-xs">
          <SkipForward className="size-3 mr-1" />
          Skipped
        </Badge>
      );
  }
}
