import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProfileData, getAvailableMonths } from "@/actions/anthropic-usage";
import { ProfileClient } from "./profile-client";
import { Skeleton } from "@/components/ui/skeleton";

export default async function ProfilePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/api/auth/signin");
  }

  const userId = Number(session.user.id);
  const [profileData, availableMonths] = await Promise.all([
    getProfileData(userId),
    getAvailableMonths(userId),
  ]);

  return (
    <Suspense fallback={<ProfileSkeleton />}>
      <ProfileClient data={profileData} availableMonths={availableMonths} />
    </Suspense>
  );
}

function ProfileSkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-48 w-full rounded-lg" />
      <Skeleton className="h-96 w-full rounded-lg" />
    </div>
  );
}
