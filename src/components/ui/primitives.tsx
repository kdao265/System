import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type Tone = "accent" | "success" | "warning" | "danger" | "muted";

export function Panel({ className = "", ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`ui-panel ${className}`} {...props} />;
}

export function SectionHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <header className="flex flex-wrap items-start justify-between gap-3">
    <div className="min-w-0"><h2 className="type-section">{title}</h2>{description && <p className="mt-2 text-muted">{description}</p>}</div>
    {children}
  </header>;
}

export function Button({ variant = "secondary", className = "", type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  return <button type={type} className={`ui-button ui-button-${variant} ${className}`} {...props} />;
}

export function Badge({ tone = "muted", className = "", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={`ui-badge ui-tone-${tone} ${className}`} {...props} />;
}

export function ProgressBar({ value, label, valueText, tone = "exp", className = "" }: {
  value: number; label: string; valueText?: string; tone?: "exp" | "main-quest" | "success"; className?: string;
}) {
  const percent = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={percent} aria-valuetext={valueText} className={`ui-progress ui-progress-${tone} ${className}`}>
    <div style={{ width: `${percent}%` }} />
  </div>;
}

export function EmptyState({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <div className="ui-empty"><p className="type-card">{title}</p>
    {description && <p className="mt-2 text-muted">{description}</p>}{children && <div className="mt-4">{children}</div>}
  </div>;
}

// Retain native label/input ownership (id, htmlFor, describedby, validation) at call sites.
export const fieldClass = "ui-field";
