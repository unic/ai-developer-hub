import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { NewToolForm } from "./new-tool-form";

export default async function NewToolPage() {
  const session = await auth();
  if (session?.user.role !== "admin") redirect("/tools");

  return <NewToolForm />;
}
