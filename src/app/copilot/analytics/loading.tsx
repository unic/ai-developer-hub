import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function CopilotAnalyticsLoading() {
  return (
    <div className="space-y-6">
      {/* Language + Editor charts side by side */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-36" />
            <Skeleton className="mt-1 h-4 w-56" />
          </CardHeader>
          <CardContent>
            <Skeleton className="min-h-[300px] w-full rounded-md" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="mt-1 h-4 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="min-h-[300px] w-full rounded-md" />
          </CardContent>
        </Card>
      </div>
      {/* Activity distribution chart */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-44" />
          <Skeleton className="mt-1 h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="min-h-[300px] w-full rounded-md" />
        </CardContent>
      </Card>
    </div>
  );
}
