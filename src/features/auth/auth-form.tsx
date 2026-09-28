"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function AuthForm() {
  const [state, action, pending] = useActionState(login, {});
  const inputClass = "mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <p className="mb-3 text-sm tracking-widest text-zinc-400">SYSTEM V1</p>
        <h1 className="text-3xl font-semibold">Sign in</h1>
        <form action={action} className="mt-8 space-y-5" aria-busy={pending}>
          <div>
            <label htmlFor="email" className="text-sm">Email</label>
            <input className={inputClass} id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div>
            <label htmlFor="password" className="text-sm">Password</label>
            <input className={inputClass} id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <div aria-live="polite" aria-atomic="true">
            {state.error && <p role="alert" className="text-sm text-red-300">{state.error}</p>}
            {state.message && <p className="text-sm leading-6 text-emerald-300">{state.message}</p>}
          </div>
          <button disabled={pending} className="w-full rounded-md bg-zinc-100 px-4 py-2 font-medium text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-50">
            {pending ? "Please wait…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
