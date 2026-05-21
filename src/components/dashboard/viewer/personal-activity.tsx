import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDistanceToNow } from "date-fns";
import { Timeline, type TimelineItem } from "@/components/shared/timeline";
import { formatCurrency } from "@/lib/utils";
import type { ViewerActivityItem } from "@/actions/dashboard";

interface PersonalActivityProps {
  activity: ViewerActivityItem[];
}

export function PersonalActivity({ activity }: PersonalActivityProps) {
  const items: TimelineItem[] = activity.map((item) => {
    const granted = item.kind === "assignment_added";
    return {
      id: item.id,
      dotClass: granted ? "bg-primary" : "bg-muted-foreground",
      primary: (
        <>
          {granted ? "Granted" : "Revoked"}{" "}
          <span className="font-medium">{item.toolName}</span>{" "}
          <span className="text-muted-foreground">· {item.tierName}</span>
        </>
      ),
      secondary: `${item.costCents > 0 ? `${formatCurrency(item.costCents)}/mo · ` : ""}${formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}`,
    };
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity on your account</CardTitle>
        <CardDescription>Changes to your assignments</CardDescription>
      </CardHeader>
      <CardContent>
        <Timeline items={items} emptyMessage="No assignment changes yet." />
      </CardContent>
    </Card>
  );
}
