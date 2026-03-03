import { AuthGuard } from "@/components/auth-guard";
import { BulkImportForm } from "./bulk-import-form";

export default async function BulkImportPage() {
  return (
    <AuthGuard requiredRole="admin">
      <BulkImportForm />
    </AuthGuard>
  );
}
