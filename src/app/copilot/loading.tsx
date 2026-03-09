import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function CopilotOverviewLoading() {
  return (
    <div className="space-y-6">
      {/* KPI cards skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
      {/* Chart skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="mt-1 h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="min-h-[300px] w-full rounded-md" />
        </CardContent>
      </Card>
    </div>
  );
}
