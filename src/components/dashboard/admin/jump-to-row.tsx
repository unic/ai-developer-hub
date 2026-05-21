import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Wrench, Users, KeyRound, DollarSign } from "lucide-react";

interface JumpToRowProps {
  toolCount: number;
  userCount: number;
  licenseCount: number;
  budgetStatus: "on_track" | "at_risk" | null;
  budgetUtilizationPct: number;
}

export function JumpToRow({
  toolCount,
  userCount,
  licenseCount,
  budgetStatus,
  budgetUtilizationPct,
}: JumpToRowProps) {
  const cards = [
    {
      title: "AI Tools",
      href: "/tools",
      icon: Wrench,
      hint: `${toolCount} active`,
    },
    {
      title: "Users",
      href: "/users",
      icon: Users,
      hint: `${userCount} active`,
    },
    {
      title: "Assignments",
      href: "/assignments",
      icon: KeyRound,
      hint: `${licenseCount} active`,
    },
    {
      title: "Budget",
      href: "/budget",
      icon: DollarSign,
      hint:
        budgetStatus === null
          ? "no active budget"
          : budgetStatus === "at_risk"
            ? `at risk · ${budgetUtilizationPct.toFixed(0)}% YTD`
            : `on track · ${budgetUtilizationPct.toFixed(0)}% YTD`,
      hintClass:
        budgetStatus === "at_risk"
          ? "text-destructive"
          : "text-muted-foreground",
    },
  ] as const;

  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
        Jump to
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link key={card.href} href={card.href} className="block">
            <Card className="p-3 transition-colors hover:bg-accent">
              <div className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <card.icon className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{card.title}</p>
                  <p
                    className={`truncate text-[11px] ${
                      "hintClass" in card
                        ? (card as { hintClass: string }).hintClass
                        : "text-muted-foreground"
                    }`}
                  >
                    {card.hint}
                  </p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
