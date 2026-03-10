import { getCopilotSeats } from "@/actions/copilot-data";
import { SeatsTable } from "@/components/copilot/seats-table";
import { Card, CardContent } from "@/components/ui/card";
import { Users } from "lucide-react";
import Link from "next/link";

export default async function CopilotSeatsPage() {
  const result = await getCopilotSeats({ pageSize: 100 });

  if (!result.success) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">{result.error}</p>
        </CardContent>
      </Card>
    );
  }

  if (result.data.seats.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-3">
          <Users className="size-12 mx-auto text-muted-foreground" />
          <h3 className="text-lg font-medium">No seat data yet</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Enable Copilot sync in{" "}
            <Link href="/settings/integrations" className="underline text-primary">Settings</Link>{" "}
            to import seat assignments. Unmatched users can be imported via{" "}
            <Link href="/users/import" className="underline text-primary">User Import</Link>.
          </p>
        </CardContent>
      </Card>
    );
  }

  return <SeatsTable data={result.data.seats} />;
}
