import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function CopilotBillingLoading() {
  return (
    <div className="space-y-6">
      {/* KPI cards skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-28" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      {/* Billing trend chart skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-36" />
          <Skeleton className="mt-1 h-4 w-64" />
        </CardHeader>
        <CardContent>
          <Skeleton className="min-h-[300px] w-full rounded-md" />
        </CardContent>
      </Card>
      {/* Cost utilization chart skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-1 h-4 w-56" />
        </CardHeader>
        <CardContent>
          <Skeleton className="min-h-[300px] w-full rounded-md" />
        </CardContent>
      </Card>
    </div>
  );
}
