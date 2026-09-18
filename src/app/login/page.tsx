import { redirect } from "next/navigation";
import { AuthForm } from "@/features/auth/auth-form";
import { getAuthenticatedUser } from "@/features/auth/session";
import { authenticatedDestination } from "@/features/profile/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getAuthenticatedUser()) redirect(await authenticatedDestination());
  return <AuthForm mode="login" />;
}
