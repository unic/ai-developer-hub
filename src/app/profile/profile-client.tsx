"use client";

import { ProfileHeader } from "@/components/profile/profile-header";
import { ProfileAssignments } from "@/components/profile/profile-assignments";
import type { ProfileData } from "@/types";

type ProfileClientProps = {
  data: ProfileData;
};

export function ProfileClient({ data }: ProfileClientProps) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
        <p className="text-muted-foreground">
          Your personal information and assigned tools.
        </p>
      </div>

      <ProfileHeader user={data.user} />
      <ProfileAssignments assignments={data.assignments} />

      {/* Cost tracking section will be added in Phase 4 (US2) */}
    </div>
  );
}
