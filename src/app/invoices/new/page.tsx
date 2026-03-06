import { requireAdmin } from "@/lib/auth-helpers";
import { redirect } from "next/navigation";
import { InvoiceUploadForm } from "./invoice-upload-form";

export default async function InvoicesNewPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/login");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Upload Invoice</h1>
        <p className="text-muted-foreground">
          Upload a PDF invoice to auto-extract and archive it.
        </p>
      </div>
      <InvoiceUploadForm />
    </div>
  );
}
