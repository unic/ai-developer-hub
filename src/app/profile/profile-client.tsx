"use client";

import { ProfileHeader } from "@/components/profile/profile-header";
import { ProfileAssignments } from "@/components/profile/profile-assignments";
import { CostTrackingSection } from "@/components/profile/cost-tracking-section";
import type { ProfileData } from "@/types";

type ProfileClientProps = {
  data: ProfileData;
  availableMonths: string[];
};

export function ProfileClient({ data, availableMonths }: ProfileClientProps) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-medium tracking-tight text-ink">My Profile</h1>
        <p className="text-muted-foreground">
          Your personal information, assigned tools, and API costs.
        </p>
      </div>

      <ProfileHeader user={data.user} />
      <ProfileAssignments assignments={data.assignments} />
      <CostTrackingSection
        userId={data.user.id}
        initialData={data.costData}
        availableMonths={availableMonths}
      />
    </div>
  );
}
