import { AuthGuard } from "@/components/auth-guard";
import { NewBudgetForm } from "./new-budget-form";

export default async function NewBudgetPage() {
  return (
    <AuthGuard requiredRole="admin">
      <NewBudgetForm />
    </AuthGuard>
  );
}
