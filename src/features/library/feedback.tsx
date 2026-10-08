import { Notice } from "@/components/ui/primitives";
import type { Dictionary } from "@/lib/localization/dictionaries";
import type { LibraryFailure, LibrarySaved } from "./contracts";

export function validationMessage(failure: LibraryFailure | null, copy: Dictionary["library"]) {
  if (failure?.outcome !== "validation_error") return null;
  const messages = copy.validation;
  return Object.hasOwn(messages, failure.code) ? messages[failure.code as keyof typeof messages] : messages.shape;
}
export function LibraryFeedback({ failure, saved, copy }: { failure?: LibraryFailure | null; saved?: LibrarySaved | null; copy: Dictionary["library"] }) {
  if (saved) return <Notice tone="success" role="status">{saved.refreshRequired ? copy.savedRefresh : saved.effect === "existing" ? copy.existing : saved.effect === "observed" ? copy.observed : saved.effect === "unchanged" ? copy.unchanged : copy.saved}</Notice>;
  if (!failure) return null;
  let text: string = copy.unavailable;
  if (failure.outcome === "validation_error") text = validationMessage(failure, copy)!;
  if (failure.outcome === "not_found") text = copy.notFound;
  if (failure.outcome === "unauthorized") text = copy.unauthorized;
  if (failure.outcome === "onboarding_required") text = copy.onboarding;
  if (failure.outcome === "uncertain") text = copy.uncertain;
  if (failure.outcome === "conflict") text = failure.reason === "archived" ? copy.readOnly : copy.conflict;
  return <Notice tone={failure.outcome === "conflict" || failure.outcome === "uncertain" ? "warning" : "danger"} role="alert">
    <p>{text}</p>
    {failure.outcome === "unauthorized" && <a className="ui-button" href="/login">{copy.signIn}</a>}
    {failure.outcome === "onboarding_required" && <a className="ui-button" href="/onboarding">{copy.setup}</a>}
  </Notice>;
}
