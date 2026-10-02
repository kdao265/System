"use client";

import { useState } from "react";
import { getDictionary, type Locale } from "@/lib/localization/dictionaries";
import {
  type QuestManagementOperation,
  type QuestManagementReason,
  type QuestManagementState,
} from "./management-action";
import { useQuestManagement } from "./management-provider";

const INITIAL_QUEST_MANAGEMENT_STATE: QuestManagementState = { outcome: "idle" };

type QuestStatus = "draft" | "scheduled" | "active" | "completed" | "failed" | "cancelled";

function reasonMessage(reason: QuestManagementReason, locale: Locale) {
  const t = getDictionary(locale).questManage;
  return {
    account: t.account,
    validation: t.validation,
    completed: t.completed,
    goal: t.goal,
    recurring: t.recurring,
    deleted: t.deleted,
    exp: t.exp,
    conflict: t.conflict,
    stale: t.stale,
  }[reason];
}

function ConfirmAction({
  operation,
  userId,
  questId,
  pending,
  locale,
  formAction,
  cancel,
}: {
  operation: QuestManagementOperation;
  userId: string;
  questId: string;
  pending: boolean;
  locale: Locale;
  formAction: (payload: FormData) => void;
  cancel: () => void;
}) {
  const t = getDictionary(locale).questManage;
  const destructive = operation === "delete";
  const prompt = destructive ? t.deletePrompt : operation === "archive" ? t.archivePrompt : t.restorePrompt;
  const confirm = destructive ? t.confirmDelete : operation === "archive" ? t.confirmArchive : t.confirmRestore;

  return (
    <div className={`mt-3 rounded-md border p-3 text-sm ${destructive ? "border-red-900/80 bg-red-950/20" : "border-zinc-700 bg-zinc-950/70"}`}>
      <p className={destructive ? "text-red-200" : "text-zinc-200"}>{prompt}</p>
      <form action={formAction} className="mt-3 flex flex-wrap gap-2">
        <input type="hidden" name="expected_account" value={userId} />
        <input type="hidden" name="quest_id" value={questId} />
        <input type="hidden" name="operation" value={operation} />
        <button type="submit" disabled={pending}
          className={`rounded-md px-3 py-2 text-sm font-medium disabled:cursor-wait disabled:opacity-60 pointer-coarse:py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${destructive ? "bg-red-500 text-white" : "bg-zinc-100 text-zinc-950"}`}>
          {pending ? t.working : confirm}
        </button>
        <button type="button" onClick={cancel} disabled={pending}
          className="rounded-md border border-zinc-600 px-3 py-2 text-sm text-zinc-200 disabled:opacity-60 pointer-coarse:py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          {t.cancel}
        </button>
      </form>
    </div>
  );
}

export function QuestManagementControl({
  userId,
  questId,
  title,
  status,
  locale = "en",
  archived = false,
}: {
  userId: string;
  questId: string;
  title: string;
  status: QuestStatus;
  locale?: Locale;
  archived?: boolean;
}) {
  const t = getDictionary(locale).questManage;
  const { controller, state: view } = useQuestManagement();
  const state = view.questId === questId ? view.result ?? INITIAL_QUEST_MANAGEMENT_STATE : INITIAL_QUEST_MANAGEMENT_STATE;
  const pending = view.phase !== "ready";
  const [confirming, setConfirming] = useState<QuestManagementOperation | null>(null);
  async function formAction() {
    if (!confirming) return;
    await controller.submit(questId, confirming, title);
    const result = controller.getSnapshot();
    if (result.phase === "ready" && result.result?.outcome === "success") setConfirming(null);
  }

  const deleteBlocked = status === "completed";
  const feedback = state.outcome === "success"
    ? state.operation === "delete" ? t.deletedSuccess
      : state.operation === "archive" ? t.archivedSuccess
      : t.restoredSuccess
    : state.outcome === "rejected"
      ? reasonMessage(state.reason, locale)
      : state.outcome === "unknown"
        ? t.unknown
        : null;

  if (confirming) {
    return (
      <div className="min-w-0">
        <ConfirmAction operation={confirming} userId={userId} questId={questId}
          pending={pending} locale={locale} formAction={formAction}
          cancel={() => setConfirming(null)} />
        {feedback && <p role={state.outcome === "success" ? "status" : "alert"}
          className={`mt-2 text-sm ${state.outcome === "success" ? "text-emerald-300" : "text-amber-200"}`}>
          {feedback}
        </p>}
      </div>
    );
  }

  if (archived) {
    return (
      <div className="mt-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setConfirming("restore")} disabled={pending}
            className="rounded-md border border-zinc-600 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-60 pointer-coarse:py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            {t.restore}
          </button>
          <button type="button" onClick={() => setConfirming("delete")} disabled={pending || deleteBlocked}
            className="rounded-md border border-red-900 px-3 py-2 text-sm text-red-300 hover:bg-red-950/30 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:py-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300">
            {t.delete}
          </button>
        </div>
        {deleteBlocked && <p className="mt-2 text-xs text-amber-200">{t.restoreReopenFirst}</p>}
        {feedback && <p role={state.outcome === "success" ? "status" : "alert"}
          className={`mt-2 text-sm ${state.outcome === "success" ? "text-emerald-300" : "text-amber-200"}`}>
          {feedback}
        </p>}
      </div>
    );
  }

  return (
    <div className="relative shrink-0">
      <details className="group">
        <summary aria-label={`${t.actions}: ${title}`}
          className="cursor-pointer list-none rounded-md border border-zinc-700 px-2.5 py-1 text-sm text-zinc-300 hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
          <span aria-hidden="true">...</span>
        </summary>
        <div className="absolute right-0 z-20 mt-2 w-52 rounded-lg border border-zinc-700 bg-zinc-950 p-2 shadow-xl">
          <button type="button" onClick={() => setConfirming("archive")} disabled={pending}
            className="block w-full rounded-md px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-900 disabled:opacity-60">
            {t.archive}
          </button>
          <button type="button" onClick={() => setConfirming("delete")} disabled={pending || deleteBlocked}
            className="mt-1 block w-full rounded-md px-3 py-2 text-left text-sm text-red-300 hover:bg-red-950/30 disabled:cursor-not-allowed disabled:opacity-50">
            {t.delete}
          </button>
          {deleteBlocked && <p className="px-3 pb-1 pt-2 text-xs text-amber-200">{t.reopenFirst}</p>}
        </div>
      </details>
      {feedback && <p role={state.outcome === "success" ? "status" : "alert"}
        className={`mt-2 max-w-72 text-xs ${state.outcome === "success" ? "text-emerald-300" : "text-amber-200"}`}>
        {feedback}
      </p>}
    </div>
  );
}
