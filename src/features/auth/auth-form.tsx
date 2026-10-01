"use client";

import { Button, fieldClass } from "@/components/ui/primitives";
import { useState } from "react";
import { useAuthAction } from "./use-auth-action";
import { login } from "./actions";

export function AuthForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { state, action, pending, onSubmit, disabled } = useAuthAction(login,
    "Sign-in could not be confirmed. Check your connection and try again.");
  const inputClass = `${fieldClass} mt-2`;

  return (
    <main lang="en" className="flex min-h-svh items-center justify-center page-frame">
      <div className="w-full max-w-sm">
        <p className="mb-3 text-sm tracking-widest text-zinc-400">SYSTEM V1</p>
        <h1 className="type-page">Sign in</h1>
        <form action={action} onSubmit={onSubmit} className="mt-8 space-y-5" aria-busy={pending}>
          <div>
            <label htmlFor="email" className="text-sm">Email</label>
            <input className={inputClass} id="email" name="email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
          </div>
          <div>
            <label htmlFor="password" className="text-sm">Password</label>
            <input className={inputClass} id="password" name="password" value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
          </div>
          <div aria-live="polite" aria-atomic="true">
            {state.error && <p role="alert" className="text-sm text-red-300">{state.error}</p>}
            {state.message && <p className="text-sm leading-6 text-emerald-300">{state.message}</p>}
          </div>
          <Button type="submit" variant="primary" disabled={disabled} className="w-full">
            {pending ? "Please wait…" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}
