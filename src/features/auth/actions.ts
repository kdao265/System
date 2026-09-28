"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createPasswordLoginClient, createServerSupabaseClient } from "@/lib/supabase/server";
import type { AuthState } from "./state";
import { configuredOwnerId, isSystemOwner } from "./owner";

function credentials(formData: FormData) {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || !email.trim() ||
      typeof password !== "string" || !password) return null;
  return { email: email.trim(), password };
}

export async function login(_previous: AuthState, formData: FormData): Promise<AuthState> {
  try {
    const attempt = await createPasswordLoginClient();
    attempt.discard();
    const input = credentials(formData);
    if (!input) return { error: "Enter your email and password." };
    if (!configuredOwnerId()) return { error: "Unable to sign in. Check your details and try again." };
    const { supabase } = attempt;
    const { data, error } = await supabase.auth.signInWithPassword(input);
    if (error || !data.session || !isSystemOwner(data.user?.id)) {
      if (data.session) {
        // Best effort remote revocation; rejected cookies are never committed.
        try { await supabase.auth.signOut({ scope: "local" }); } catch { /* fail closed */ }
      }
      return { error: "Unable to sign in. Check your details and try again." };
    }
    attempt.commit();
  } catch {
    return { error: "Unable to sign in right now. Please try again." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signup(): Promise<AuthState> {
  // Retain a safe tombstone for direct/stale invocations. Never call Auth signup.
  return { error: "Registration is unavailable." };
}

export async function logout(): Promise<AuthState> {
  try {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) return { error: "Unable to sign out. Please try again." };
  } catch {
    return { error: "Unable to sign out right now. Please try again." };
  }

  revalidatePath("/", "layout");
  redirect("/login");
}
