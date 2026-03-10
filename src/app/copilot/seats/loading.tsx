import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function CopilotSeatsLoading() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-1 h-4 w-64" />
      </CardHeader>
      <CardContent>
        {/* Table header */}
        <div className="flex gap-4 border-b pb-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
        </div>
        {/* Table rows */}
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-4 border-b py-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
