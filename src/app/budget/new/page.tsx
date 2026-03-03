import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { NewBudgetForm } from "./new-budget-form";

export default async function NewBudgetPage() {
  const session = await auth();
  if (session?.user.role !== "admin") redirect("/budget");

  return <NewBudgetForm />;
}
