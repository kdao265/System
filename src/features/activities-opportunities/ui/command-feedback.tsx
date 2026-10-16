"use client";

import { Button, Notice } from "@/components/ui/primitives";
import type { CommandState } from "../command-session";
import type { FieldFailure } from "../application";
import { coreCopy, type AoField } from "./core-copy";
import type { AoLocale } from "./ui-copy";

export function CommandFeedback({ state, locale, failure, onConfirm, onCancel }: {
  state: CommandState; locale: AoLocale; failure?: FieldFailure | null; onConfirm(): void; onCancel(): void;
}) {
  const t = coreCopy[locale];
  const warning = state.preparation?.outcome === "ready" && state.preparation.warnings.length && !state.result && !state.busy;
  return <div className="ao-command-feedback" aria-live="polite" aria-atomic="true">
    {failure && <Notice tone="danger" role="alert">{t.fields[failure.field as AoField] ?? t.rejected}: {t.errors[failure.code]}</Notice>}
    {state.busy && <p role="status">{t.working}</p>}
    {state.result && <Notice role={state.result.outcome === "success" ? "status" : "alert"}
      tone={state.result.outcome === "success" ? "success" : "warning"}>{t[state.result.outcome]}</Notice>}
    {!!warning && state.preparation?.outcome === "ready" && <Notice tone="warning" role="status">
      <p>{t.warning}</p><ul>{state.preparation.warnings.map(code => <li key={code}>{t.warnings[code]}</li>)}</ul>
      <div className="ao-core-actions"><Button onClick={onConfirm}>{t.confirm}</Button><Button onClick={onCancel}>{t.cancel}</Button></div>
    </Notice>}
  </div>;
}
