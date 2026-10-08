"use client";

import type { Dictionary } from "@/lib/localization/dictionaries";
import { BOOK_LIMITS, BOOK_STATUSES, characterCount, type BookFields } from "./model";
import type { LibraryFailure } from "./contracts";
import { validationMessage } from "./feedback";

export const blankBookFields = (): BookFields => ({ title: "", author: "", cover_url: "", status: "want_to_read", summary: "", content_notes: "", lessons: "" });

export function BookFieldInputs({ value, onChange, disabled, failure, copy, prefix }: {
  value: BookFields; onChange: (fields: BookFields) => void; disabled: boolean;
  failure: LibraryFailure | null; copy: Dictionary["library"]; prefix: string;
}) {
  const invalid = failure?.outcome === "validation_error" ? failure.field : null;
  return <fieldset disabled={disabled} className="library-fields">
    {(["title", "author", "cover_url", "status", "summary", "content_notes", "lessons"] as const).map(field => {
      const id = `${prefix}-${field}`;
      const long = field === "summary" || field === "content_notes" || field === "lessons";
      const props = { id, name: field, className: "ui-field", "aria-invalid": invalid === field || undefined,
        "aria-describedby": `${id}-hint${invalid === field ? ` ${id}-error` : ""}` };
      return <div className={long || field === "title" ? "library-field library-field-wide" : "library-field"} key={field}>
        <div className="library-field-label"><label htmlFor={id}>{copy.fields[field]}</label><span className="library-field-kind">{field === "title" ? copy.required : field !== "status" ? copy.optional : ""}</span></div>
        {field === "status" ? <select {...props} value={value.status} onChange={e => onChange({ ...value, status: e.target.value as BookFields["status"] })}>
          {BOOK_STATUSES.map(status => <option key={status} value={status}>{copy.statuses[status]}</option>)}
        </select> : long ? <textarea {...props} rows={field === "summary" ? 4 : 8} value={value[field] ?? ""} onChange={e => onChange({ ...value, [field]: e.target.value })} />
          : <input {...props} type={field === "cover_url" ? "url" : "text"} required={field === "title"} value={value[field] ?? ""} onChange={e => onChange({ ...value, [field]: e.target.value })} />}
        <p id={`${id}-hint`} className="library-field-hint">{field === "cover_url" ? `${copy.coverHint} ` : ""}
          {field !== "status" && `${characterCount(value[field] ?? "")} / ${BOOK_LIMITS[field]} ${copy.characters}`}</p>
        {invalid === field && <p id={`${id}-error`} className="text-danger">{validationMessage(failure, copy)}</p>}
      </div>;
    })}
  </fieldset>;
}
