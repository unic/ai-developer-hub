import { format } from "date-fns";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { licenseAssignments } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth-helpers";
import { decryptApiKey } from "@/lib/crypto";
import { toCsv, csvResponse } from "@/lib/csv";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return new Response("Unauthorized", { status: 401 });
  }

  const data = await db.query.licenseAssignments.findMany({
    columns: {
      workspace: true,
      apiKeyEncrypted: true,
      assignedAt: true,
    },
    with: {
      user: { columns: { email: true } },
      tool: { columns: { name: true } },
      tier: { columns: { name: true } },
    },
    orderBy: [desc(licenseAssignments.assignedAt)],
  });

  const csvRows = await Promise.all(
    data.map(async (row) => {
      let apiKey = "";
      if (row.apiKeyEncrypted) {
        try {
          apiKey = await decryptApiKey(row.apiKeyEncrypted);
        } catch {
          apiKey = "";
        }
      }
      return [
        row.user.email,
        row.tool.name,
        row.tier.name,
        row.workspace ?? "",
        apiKey,
        format(row.assignedAt, "yyyy-MM-dd"),
      ];
    })
  );

  const csv = toCsv(
    ["email", "tool", "tier", "workspace", "api_key", "assigned_at"],
    csvRows
  );

  return csvResponse(csv, "assignments");
}
