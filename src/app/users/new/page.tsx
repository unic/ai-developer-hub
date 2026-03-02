import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { NewUserForm } from "./new-user-form";

export default async function NewUserPage() {
  const session = await auth();
  if (session?.user.role !== "admin") redirect("/users");

  return <NewUserForm />;
}
