import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users,
  UserCheck,
  TrendingUp,
  Lightbulb,
  CheckCheck,
} from "lucide-react";

interface OverviewCardsProps {
  totalSeats: number;
  activeSeats: number;
  acceptanceRate: number;
  totalSuggestions: number;
  totalAcceptances: number;
}

export function OverviewCards({
  totalSeats,
  activeSeats,
  acceptanceRate,
  totalSuggestions,
  totalAcceptances,
}: OverviewCardsProps) {
  const cards = [
    {
      title: "Total Seats",
      value: totalSeats.toLocaleString(),
      icon: Users,
    },
    {
      title: "Active Seats",
      value: activeSeats.toLocaleString(),
      description:
        totalSeats > 0
          ? `${Math.round((activeSeats / totalSeats) * 100)}% utilization`
          : undefined,
      icon: UserCheck,
    },
    {
      title: "Acceptance Rate",
      value: `${acceptanceRate}%`,
      icon: TrendingUp,
    },
    {
      title: "Suggestions",
      value: totalSuggestions.toLocaleString(),
      icon: Lightbulb,
    },
    {
      title: "Acceptances",
      value: totalAcceptances.toLocaleString(),
      icon: CheckCheck,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
            <card.icon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
            {card.description && (
              <p className="text-xs text-muted-foreground">
                {card.description}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
