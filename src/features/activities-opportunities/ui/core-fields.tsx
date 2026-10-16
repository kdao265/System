"use client";

import type { ReactNode } from "react";
import { coreCopy, type AoField } from "./core-copy";
import type { AoLocale } from "./ui-copy";
import type { FieldFailure } from "../application";
import { unicodeCodePoints } from "../model";

export function Field({ name, prefix, locale, failure, children }: {
  name: AoField; prefix: string; locale: AoLocale; failure?: FieldFailure | null; children: ReactNode;
}) {
  const t = coreCopy[locale];
  return <div className="ao-core-field">
    <label htmlFor={`${prefix}-${name}`}>{t.fields[name]}</label>{children}
    {failure?.field === name && <p id={`${prefix}-${name}-error`} className="text-danger">{t.errors[failure.code]}</p>}
  </div>;
}
type Common = { name: AoField; prefix: string; locale: AoLocale; failure?: FieldFailure | null };
export function TextField(props: Common & { value: string | null; onChange(value: string): void; limit?: number; multiline?: boolean; required?: boolean }) {
  const { name, prefix, locale, value, onChange, limit, multiline, required, failure } = props;
  const id = `${prefix}-${name}`;
  const control = { id, name, className: "ui-field", value: value ?? "", required,
    "aria-invalid": failure?.field === name || undefined,
    "aria-describedby": [limit ? `${id}-hint` : "", failure?.field === name ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value) };
  return <Field {...props}>{multiline ? <textarea {...control} rows={3}/> : <input {...control}/>}
    {limit && <small id={`${id}-hint`}>{unicodeCodePoints(value ?? "")} / {limit} {coreCopy[locale].characters} · {required ? coreCopy[locale].required : coreCopy[locale].optional}</small>}
  </Field>;
}
export function SelectField<T extends string>(props: Common & { value: T | ""; onChange(value: T | ""): void; choices: readonly T[]; labels: Record<T, string>; nullable?: boolean }) {
  const { name, prefix, locale, value, onChange, choices, labels, nullable, failure } = props;
  return <Field {...props}><select className="ui-field" id={`${prefix}-${name}`} name={name} value={value}
    aria-invalid={failure?.field === name || undefined} aria-describedby={failure?.field === name ? `${prefix}-${name}-error` : undefined}
    onChange={e => onChange(e.target.value as T | "")}>
    {nullable && <option value="">{coreCopy[locale].unset}</option>}
    {choices.map(choice => <option key={choice} value={choice}>{labels[choice]}</option>)}
  </select></Field>;
}
