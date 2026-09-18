"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { AuthState } from "./state";

function credentials(formData: FormData) {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || !email.trim() ||
      typeof password !== "string" || !password) return null;
  return { email: email.trim(), password };
}

export async function login(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const input = credentials(formData);
  if (!input) return { error: "Enter your email and password." };

  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword(input);
    if (error || !data.session) {
      return { error: "Unable to sign in. Check your details and email confirmation, then try again." };
    }
  } catch {
    return { error: "Unable to sign in right now. Please try again." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signup(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const input = credentials(formData);
  if (!input) return { error: "Enter your email and password." };
  if (input.password !== formData.get("confirmPassword")) {
    return { error: "Passwords must match." };
  }

  try {
    const supabase = await createServerSupabaseClient();
    // Profile provisioning belongs solely to the auth.users database trigger.
    const { data, error } = await supabase.auth.signUp(input);
    if (error) {
      return { error: "Unable to complete signup. Check your details, use a strong password, or try signing in." };
    }
    if (!data.session) {
      return { message: "Signup request received. If email confirmation is needed, check your inbox and follow the confirmation link, then return here to sign in. If you already have an account, sign in." };
    }
  } catch {
    return { error: "Unable to complete signup right now. Please try again." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
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
