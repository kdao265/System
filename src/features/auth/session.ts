import { cache } from "react";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// React cache deduplicates only within a server render, not across users.
export const getAuthenticatedUser = cache(async () => {
  const supabase = await createServerSupabaseClient(true);
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
});

export async function requireUser() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  return user;
}
