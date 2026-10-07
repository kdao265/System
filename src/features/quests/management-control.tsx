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
    <div className={`quest-management-confirm ${destructive ? "quest-management-confirm-danger" : ""}`}>
      <p>{prompt}</p>
      <form action={formAction} className="mt-3 flex flex-wrap gap-2">
        <input type="hidden" name="expected_account" value={userId} />
        <input type="hidden" name="quest_id" value={questId} />
        <input type="hidden" name="operation" value={operation} />
        <button type="submit" disabled={pending}
          className={`ui-button ${destructive ? "ui-button-danger" : "ui-button-primary"}`}>
          {pending ? t.working : confirm}
        </button>
        <button type="button" onClick={cancel} disabled={pending}
          className="ui-button">
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
          className={`quest-management-feedback ${state.outcome === "success" ? "quest-control-feedback-success" : "quest-control-feedback-warning"}`}>
          {feedback}
        </p>}
      </div>
    );
  }

  if (archived) {
    return (
      <div className="mt-3">
        <div className="quest-management-actions">
          <button type="button" onClick={() => setConfirming("restore")} disabled={pending}
            className="ui-button">
            {t.restore}
          </button>
          <button type="button" onClick={() => setConfirming("delete")} disabled={pending || deleteBlocked}
            className="ui-button ui-button-danger">
            {t.delete}
          </button>
        </div>
        {deleteBlocked && <p className="quest-management-hint">{t.restoreReopenFirst}</p>}
        {feedback && <p role={state.outcome === "success" ? "status" : "alert"}
          className={`quest-management-feedback ${state.outcome === "success" ? "quest-control-feedback-success" : "quest-control-feedback-warning"}`}>
          {feedback}
        </p>}
      </div>
    );
  }

  return (
    <div className="relative shrink-0">
      <details className="group">
        <summary aria-label={`${t.actions}: ${title}`}
          className="quest-management-summary">
          <span aria-hidden="true">...</span>
        </summary>
        <div className="quest-management-menu">
          <button type="button" onClick={() => setConfirming("archive")} disabled={pending}
            className="quest-management-menu-action">
            {t.archive}
          </button>
          <button type="button" onClick={() => setConfirming("delete")} disabled={pending || deleteBlocked}
            className="quest-management-menu-action quest-management-menu-danger">
            {t.delete}
          </button>
          {deleteBlocked && <p className="quest-management-hint">{t.reopenFirst}</p>}
        </div>
      </details>
      {feedback && <p role={state.outcome === "success" ? "status" : "alert"}
        className={`quest-management-feedback ${state.outcome === "success" ? "quest-control-feedback-success" : "quest-control-feedback-warning"}`}>
        {feedback}
      </p>}
    </div>
  );
}
