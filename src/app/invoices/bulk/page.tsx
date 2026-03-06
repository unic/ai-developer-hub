import { requireAdmin } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";
import { BulkUploadForm } from "./bulk-upload-form";

export default async function BulkUploadPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/login");

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Bulk Upload</h1>
      <p className="text-muted-foreground">
        Upload a ZIP file containing PDF invoices. Each PDF will be extracted
        and parsed automatically so you can review the results before saving.
      </p>
      <BulkUploadForm />
    </div>
  );
}
