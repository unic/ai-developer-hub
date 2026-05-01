import { normalizeCircle } from "@/lib/utils";
import type { CircleReportItem } from "@/types";

type UserWithCircle = { id: number; circle: string | null };
type AssignmentWithUser = { user: { id: number }; costAtAssignmentCents: number };

export function buildCircleReport(
  userList: UserWithCircle[],
  activeAssignments: AssignmentWithUser[]
): CircleReportItem[] {
  const normalizedUsers = userList.map((u) => ({
    ...u,
    circle: normalizeCircle(u.circle),
  }));

  const circles = [...new Set(normalizedUsers.map((u) => u.circle))];

  return circles.map((circle) => {
    const circleUsers = normalizedUsers.filter((u) => u.circle === circle);
    const circleUserIds = new Set(circleUsers.map((u) => u.id));
    const circleAssignments = activeAssignments.filter((a) =>
      circleUserIds.has(a.user.id)
    );
    const totalCost = circleAssignments.reduce(
      (s, a) => s + a.costAtAssignmentCents,
      0
    );
    return {
      circle,
      userCount: circleUsers.length,
      licenseCount: circleAssignments.length,
      totalMonthlyCost: totalCost,
    };
  });
}
