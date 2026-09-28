import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { configuredOwnerId, isSystemOwner } from "./owner";

// React cache deduplicates only within a server render, not across users.
export const getAuthenticatedUser = cache(async () => {
  if (!configuredOwnerId()) return null;
  const supabase = await createServerSupabaseClient(true);
  const { data, error } = await supabase.auth.getUser();
  return !error && isSystemOwner(data.user?.id) ? data.user : null;
});

export async function requireUser() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  return user;
}
