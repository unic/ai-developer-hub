import { format } from "date-fns";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { licenseAssignments } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth-helpers";
import { decryptApiKey } from "@/lib/crypto";
import { toCsv, csvResponse } from "@/lib/csv";
import { DECRYPTION_FAILED_SENTINEL } from "./constants";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return new Response("Unauthorized", { status: 401 });
  }

  const data = await db.query.licenseAssignments.findMany({
    columns: {
      id: true,
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

  const DECRYPT_BATCH_SIZE = 50;
  const csvRows: string[][] = [];
  let decryptionFailures = 0;

  for (let i = 0; i < data.length; i += DECRYPT_BATCH_SIZE) {
    const batch = data.slice(i, i + DECRYPT_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (row): Promise<{ cells: string[]; failed: boolean }> => {
        let apiKey = "";
        let failed = false;
        if (row.apiKeyEncrypted) {
          try {
            apiKey = await decryptApiKey(row.apiKeyEncrypted);
          } catch (err) {
            console.error(
              `[assignments-export] Decryption failed for assignment id=${row.id}`,
              err
            );
            apiKey = DECRYPTION_FAILED_SENTINEL;
            failed = true;
          }
        }
        return {
          cells: [
            row.user.email,
            row.tool.name,
            row.tier.name,
            row.workspace ?? "",
            apiKey,
            format(row.assignedAt, "yyyy-MM-dd"),
          ],
          failed,
        };
      })
    );
    csvRows.push(...batchResults.map((r) => r.cells));
    decryptionFailures += batchResults.filter((r) => r.failed).length;
  }

  const csv = toCsv(
    ["email", "tool", "tier", "workspace", "api_key", "assigned_at"],
    csvRows
  );

  if (decryptionFailures === 0) {
    return csvResponse(csv, "assignments");
  }

  const base = csvResponse(csv, "assignments");
  const headers = new Headers(base.headers);
  headers.set("X-Decryption-Failures", String(decryptionFailures));
  return new Response(csv, { headers });
}
