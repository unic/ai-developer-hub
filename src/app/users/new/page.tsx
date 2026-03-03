import { AuthGuard } from "@/components/auth-guard";
import { NewUserForm } from "./new-user-form";

export default async function NewUserPage() {
  return (
    <AuthGuard requiredRole="admin">
      <NewUserForm />
    </AuthGuard>
  );
}
