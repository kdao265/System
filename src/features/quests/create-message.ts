import type { QuestCreationReceipt } from "./create-receipt";

export type OneOffCreationSuccess = {
  kind: "one_off_created";
  replay: boolean;
  timezone: string;
  scheduledAt: string | null;
  deadlineAt: string | null;
  belongsToday: boolean;
};

export function oneOffCreationSuccess(
  receipt: QuestCreationReceipt,
  timezone: string,
  now = new Date(),
): OneOffCreationSuccess {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const times = [receipt.scheduled_at, receipt.deadline_at]
    .filter((time): time is string => time !== null);

  const today = day.format(now);
  const belongsToday = times.some(
    (time) => day.format(new Date(time)) === today,
  );

  return {
    kind: "one_off_created",
    replay: receipt.replay,
    timezone,
    scheduledAt: receipt.scheduled_at,
    deadlineAt: receipt.deadline_at,
    belongsToday,
  };
}
