import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { BulkImportForm } from "./bulk-import-form";

export default async function BulkImportPage() {
  const session = await auth();
  if (session?.user.role !== "admin") redirect("/users");

  return <BulkImportForm />;
}
