import { unstable_rethrow } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireUser } from "@/features/auth/session";
import { parseCalendar } from "./model";

export async function getCalendar(from: string, to: string) {
  await requireUser();
  try {
    const client = await createServerSupabaseClient(true);
    const { data, error } = await client.rpc("get_calendar_events", { p_from: from, p_to: to });
    return error ? null : parseCalendar(data);
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}
