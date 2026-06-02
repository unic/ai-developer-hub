"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { TopUsersBarChart } from "@/components/claude/top-users-bar-chart";
import type { UserListRow } from "@/types";

/**
 * Client wrapper for the Top-10 users chart that owns the "Use workspace colors"
 * toggle (mirrors the Workspaces tab). Default is monochrome; the preference is
 * persisted under the SAME localStorage key as the workspace daily chart, so
 * flipping it on either Claude tab keeps both in sync.
 */
export function TopUsersCard({ users }: { users: UserListRow[] }) {
  const [useDbColors, setUseDbColors] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("claude-dashboard:useDbColors") === "true") {
      setUseDbColors(true);
    }
  }, []);
  useEffect(() => {
    localStorage.setItem("claude-dashboard:useDbColors", String(useDbColors));
  }, [useDbColors]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle className="text-base">Top 10 Users by Cost</CardTitle>
          <div className="flex items-center gap-2">
            <Switch
              id="top-users-db-colors"
              checked={useDbColors}
              onCheckedChange={setUseDbColors}
            />
            <Label
              htmlFor="top-users-db-colors"
              className="cursor-pointer text-xs text-muted-foreground"
            >
              Use workspace colors
            </Label>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <TopUsersBarChart users={users} useDbColors={useDbColors} />
      </CardContent>
    </Card>
  );
}
