import { format } from "date-fns";
import { asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth-helpers";
import { toCsv } from "@/lib/csv";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return new Response("Unauthorized", { status: 401 });
  }

  const data = await db
    .select({
      name: users.name,
      email: users.email,
      circle: users.circle,
      role: users.role,
      githubUsername: users.githubUsername,
      profile: users.profile,
    })
    .from(users)
    .orderBy(asc(users.name));

  const csvRows = data.map((row) => [
    row.name,
    row.email,
    row.circle,
    row.role,
    row.githubUsername ?? "",
    row.profile ?? "",
  ]);

  const csv = toCsv(
    ["name", "email", "circle", "role", "github_username", "profile"],
    csvRows
  );

  const today = format(new Date(), "yyyy-MM-dd");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="users-export-${today}.csv"`,
    },
  });
}
