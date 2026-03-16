import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KeyRound } from "lucide-react";
import { formatDate } from "@/lib/utils";

type Assignment = {
  id: number;
  toolName: string;
  tierName: string;
  assignedAt: Date;
  status: "active" | "inactive";
};

type ProfileAssignmentsProps = {
  assignments: Assignment[];
};

export function ProfileAssignments({ assignments }: ProfileAssignmentsProps) {
  if (assignments.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="size-5" />
            Assigned Tools
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No tools assigned yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <KeyRound className="size-5" />
          Assigned Tools
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {assignments.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div>
                <p className="font-medium">{a.toolName}</p>
                <p className="text-sm text-muted-foreground">
                  {a.tierName} &middot; Assigned {formatDate(a.assignedAt)}
                </p>
              </div>
              <Badge
                variant={a.status === "active" ? "default" : "secondary"}
                className="capitalize"
              >
                {a.status}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
