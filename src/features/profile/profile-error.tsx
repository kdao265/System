import { LogoutForm } from "@/features/auth/logout-form";

export function ProfileError({ missing }: { missing: boolean }) {
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <p className="text-sm tracking-widest text-zinc-400">SYSTEM V1</p>
      <h1 className="mt-3 text-3xl font-semibold">Profile unavailable</h1>
      <p role="alert" className="mt-6 text-zinc-300">
        {missing
          ? "Your account profile is missing. Ask the administrator to check your account."
          : "We could not load your profile. Please try again."}
      </p>
      <a href="/onboarding" className="mt-6 inline-block underline underline-offset-4">Try again</a>
      <LogoutForm />
    </main>
  );
}
