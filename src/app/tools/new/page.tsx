import { AuthGuard } from "@/components/auth-guard";
import { NewToolForm } from "./new-tool-form";

export default async function NewToolPage() {
  return (
    <AuthGuard requiredRole="admin">
      <NewToolForm />
    </AuthGuard>
  );
}
