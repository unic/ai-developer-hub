"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserTopMoversChips } from "@/components/claude/user-top-movers-chips";
import { UsersTable } from "@/components/claude/users-table";
import type { UserListRow, UserSparkline, UserTopMover } from "@/types";

/**
 * Client wrapper that owns the users-table search state so the top-movers
 * chips can imperatively filter the table on click (T212).
 *
 * Lives in its own file because the parent page is a Server Component — this
 * is the smallest "use client" island that lets the chip → search wiring stay
 * local without forcing the whole page to render on the client.
 */
export function UsersTableWithMovers({
  users,
  sparklines,
  movers,
  histogram,
}: {
  users: UserListRow[];
  sparklines: Record<number, UserSparkline[]>;
  movers: UserTopMover[];
  /**
   * Pre-rendered histogram element — kept as a prop so the histogram itself
   * can stay a Server Component (no need for both halves of the row to
   * become client components just to share a parent).
   */
  histogram: React.ReactNode;
}) {
  const [search, setSearch] = useState("");

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {histogram}
        <UserTopMoversChips movers={movers} onSelect={setSearch} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Users</CardTitle>
        </CardHeader>
        <CardContent>
          <UsersTable
            users={users}
            sparklines={sparklines}
            searchValue={search}
            onSearchChange={setSearch}
          />
        </CardContent>
      </Card>
    </>
  );
}
