import { AuthGuard } from "@/components/auth-guard";
import { BulkAssignmentImportForm } from "./bulk-assignment-import-form";

export default async function BulkAssignmentImportPage() {
  return (
    <AuthGuard requiredRole="admin">
      <BulkAssignmentImportForm />
    </AuthGuard>
  );
}
