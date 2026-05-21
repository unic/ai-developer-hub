import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface CatalogLinkCardProps {
  availableToolCount: number;
}

export function CatalogLinkCard({ availableToolCount }: CatalogLinkCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Available tools</CardTitle>
        <CardDescription>
          {availableToolCount > 0
            ? `${availableToolCount} more tool${availableToolCount === 1 ? "" : "s"} available in your org`
            : "You have access to every active tool"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Browse the full catalog and ask your lead if you need access to
          something new.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/tools">
            Browse all tools
            <ArrowRight className="ml-2 size-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
