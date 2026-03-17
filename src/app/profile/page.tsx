import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getProfileData, getAvailableMonths } from "@/actions/anthropic-usage";
import { ProfileClient } from "./profile-client";

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
    <ProfileClient data={profileData} availableMonths={availableMonths} />
  );
}
