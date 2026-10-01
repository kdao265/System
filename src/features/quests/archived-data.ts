import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/features/auth/session";
import { isAbsoluteTimestamp } from "./create-model";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["draft", "scheduled", "active", "completed", "failed", "cancelled"] as const;

export type ArchivedQuest = {
  id: string;
  title: string;
  archived_at: string;
  occurrence_id: string;
  status: (typeof STATUSES)[number];
};

export type ArchivedQuestResult =
  | { status: "ok"; quests: ArchivedQuest[] }
  | { status: "session-expired" | "invalid" | "unavailable" };

function parseArchivedQuests(value: unknown): ArchivedQuestResult {
  if (!Array.isArray(value)) return { status: "invalid" };
  const quests: ArchivedQuest[] = [];
  const ids = new Set<string>();

  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { status: "invalid" };
    const row = raw as Record<string, unknown>;
    const occurrences = row.occurrences;
    if (
      typeof row.id !== "string" || !UUID.test(row.id) || ids.has(row.id) ||
      typeof row.title !== "string" || row.title.trim() === "" || [...row.title].length > 120 ||
      typeof row.archived_at !== "string" || !isAbsoluteTimestamp(row.archived_at) ||
      !Array.isArray(occurrences) || occurrences.length !== 1
    ) return { status: "invalid" };

    const occurrence = occurrences[0];
    if (!occurrence || typeof occurrence !== "object" || Array.isArray(occurrence)) return { status: "invalid" };
    const item = occurrence as Record<string, unknown>;
    if (
      typeof item.id !== "string" || !UUID.test(item.id) ||
      typeof item.status !== "string" ||
      !STATUSES.includes(item.status as (typeof STATUSES)[number])
    ) return { status: "invalid" };

    ids.add(row.id);
    quests.push({
      id: row.id,
      title: row.title,
      archived_at: row.archived_at,
      occurrence_id: item.id,
      status: item.status as ArchivedQuest["status"],
    });
  }
  return { status: "ok", quests };
}

export async function getArchivedOneOffQuests(): Promise<ArchivedQuestResult> {
  if (!await getAuthenticatedUser()) return { status: "session-expired" };
  try {
    const supabase = await createServerSupabaseClient(true);
    const { data, error } = await supabase
      .from("quests")
      .select("id,title,archived_at,occurrences:quest_occurrences!fk_occurrence_quest_owner(id,status)")
      .eq("recurrence_mode", "one_off")
      .not("archived_at", "is", null)
      .is("deleted_at", null)
      .order("archived_at", { ascending: false });
    return error ? { status: "unavailable" } : parseArchivedQuests(data);
  } catch {
    return { status: "unavailable" };
  }
}
