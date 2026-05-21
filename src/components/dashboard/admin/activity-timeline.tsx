import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDistanceToNow } from "date-fns";
import { Timeline, type TimelineItem } from "@/components/shared/timeline";
import type { DashboardActivityItem } from "@/actions/dashboard";

interface ActivityTimelineProps {
  activity: DashboardActivityItem[];
}

const DOT_CLASSES: Record<DashboardActivityItem["severity"], string> = {
  info: "bg-muted-foreground",
  success: "bg-green-500 dark:bg-green-400",
  warn: "bg-yellow-500 dark:bg-yellow-400",
  danger: "bg-destructive",
};

export function ActivityTimeline({ activity }: ActivityTimelineProps) {
  const items: TimelineItem[] = activity.map((item) => ({
    id: item.id,
    dotClass: DOT_CLASSES[item.severity],
    primary: item.title,
    secondary: `${item.detail ? `${item.detail} · ` : ""}${formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}`,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>
          Invoice ingestions and assignment changes
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Timeline items={items} />
      </CardContent>
    </Card>
  );
}
