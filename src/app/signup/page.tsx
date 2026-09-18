import { redirect } from "next/navigation";
import { AuthForm } from "@/features/auth/auth-form";
import { getAuthenticatedUser } from "@/features/auth/session";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await getAuthenticatedUser()) redirect("/dashboard");
  return <AuthForm mode="signup" />;
}
