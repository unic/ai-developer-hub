import { getCopilotSeatDetail } from "@/actions/copilot-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export default async function CopilotSeatDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const githubId = parseInt(userId, 10);
  if (isNaN(githubId)) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">Invalid user ID</p>
        </CardContent>
      </Card>
    );
  }

  const result = await getCopilotSeatDetail({ githubId });
  if (!result.success) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">{result.error}</p>
        </CardContent>
      </Card>
    );
  }

  const seat = result.data;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/copilot/seats">
          <ArrowLeft className="size-4 mr-2" />
          Back to Seats
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            {seat.avatarUrl && (
              <Image src={seat.avatarUrl} alt="" width={48} height={48} className="size-12 rounded-full" unoptimized />
            )}
            <div>
              <CardTitle>{seat.githubLogin}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={seat.status === "active" ? "default" : "outline"} className="capitalize">{seat.status}</Badge>
                <Badge variant="outline" className="capitalize">{seat.planType}</Badge>
                {seat.matchedUserName ? (
                  <span className="text-sm text-muted-foreground">
                    Matched to{" "}
                    <Link href={`/users`} className="underline">{seat.matchedUserName}</Link>
                  </span>
                ) : (
                  <span className="text-sm text-amber-600">Unmatched</span>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Assigned</div>
              <div className="text-sm">{new Date(seat.assignedAt).toLocaleDateString()}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Last Activity</div>
              <div className="text-sm">{seat.lastActivityAt ? new Date(seat.lastActivityAt).toLocaleDateString() : "N/A"}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Editor</div>
              <div className="text-sm">{seat.lastActivityEditor ?? "N/A"}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">GitHub ID</div>
              <div className="text-sm">{seat.githubId}</div>
            </div>
          </div>

          {/* Activity Timeline */}
          {seat.activityTimeline.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-3">Sync History</h3>
              <div className="space-y-2">
                {seat.activityTimeline.map((event, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground w-24">{new Date(event.date).toLocaleDateString()}</span>
                    <Badge variant="outline" className="text-xs">{event.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
