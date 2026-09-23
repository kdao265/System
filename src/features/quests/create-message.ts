import type { QuestCreationReceipt } from "./create-receipt";
import { formatProfileLocal } from "./time";

export function creationSuccessMessage(receipt: QuestCreationReceipt, timezone: string, now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const times = [receipt.scheduled_at, receipt.deadline_at].filter((time): time is string => time !== null);
  const today = day.format(now);
  const belongsToday = times.some((time) => day.format(new Date(time)) === today);
  const timing = [
    receipt.scheduled_at && `planned start ${formatProfileLocal(receipt.scheduled_at, timezone)}`,
    receipt.deadline_at && `deadline ${formatProfileLocal(receipt.deadline_at, timezone)}`,
  ].filter(Boolean).join(", ");
  return `Quest created: ${timing} (${timezone}).${belongsToday ? "" : " Daily Quests shows today only; this Quest has neither a planned start nor a deadline today."}${receipt.replay ? " The earlier accepted creation was returned." : ""}`;
}

