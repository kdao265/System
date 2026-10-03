import { unstable_rethrow } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireUser } from "@/features/auth/session";
import { parseCalendarV2 } from "./model";

export async function getCalendar(from: string, to: string) {
  await requireUser();
  try {
    const client = await createServerSupabaseClient(true);
    const { data, error } = await client.rpc("get_calendar_events_v2", { p_from: from, p_to: to });
    return error ? null : parseCalendarV2(data);
  } catch (error) {
    unstable_rethrow(error);
    return null;
  }
}
