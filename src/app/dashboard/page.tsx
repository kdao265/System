import { LogoutForm } from "@/features/auth/logout-form";
import { requireUser } from "@/features/auth/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl">
        <h1 className="text-4xl font-semibold tracking-tight">SYSTEM V1</h1>
        <p className="mt-6 text-zinc-300">You are signed in.</p>
        <p className="mt-2 break-words text-sm text-zinc-400">{user.email}</p>
        <LogoutForm />
      </div>
    </main>
  );
}
