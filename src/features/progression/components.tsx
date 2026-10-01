import { Panel, ProgressBar } from "@/components/ui/primitives";
import type { ExpProgress } from "./numbers";

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Panel aria-label={label}>{children}</Panel>
  );
}

export function PlayerSummary({ email, displayName }: { email: string; displayName: string | null }) {
  return (
    <Card label="Player status">
      <p className="type-metadata tracking-widest text-muted">PLAYER</p>
      <h2 className="mt-2 break-words text-2xl font-semibold tracking-tight text-zinc-50">
        {displayName || "Operator"}
      </h2>
      <p className="mt-1 break-all text-sm text-zinc-400">{email}</p>
    </Card>
  );
}

function ProgressionUnavailable() {
  return (
    <Card label="Progression status: not configured">
      <p className="type-metadata tracking-widest text-muted">PROGRESSION</p>
      <p className="mt-3 text-zinc-300">Level system not configured.</p>
      <p className="mt-1 text-sm text-zinc-400">
        No progression policy is assigned to your account yet. Ask the administrator to publish and
        assign one.
      </p>
    </Card>
  );
}

function ProgressionInvalid() {
  return (
    <Card label="Progression status: data error">
      <p className="type-metadata tracking-widest text-muted">PROGRESSION</p>
      <p role="alert" className="mt-3 break-words text-zinc-300">
        Progression data could not be read safely.
      </p>
      <p className="mt-1 text-sm text-zinc-400">Please try again from the dashboard.</p>
      <a
        href="/dashboard"
        className="mt-4 inline-block rounded-md border border-zinc-600 px-4 py-2 text-sm underline-offset-4 hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white pointer-coarse:py-3"
      >
        Retry
      </a>
    </Card>
  );
}

function ProgressionAvailable({ exp }: { exp: Extract<ExpProgress, { state: "available" }> }) {
  const percent = exp.percentInLevel;
  return (
    <Card label="Progression status">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="type-metadata tracking-widest text-muted">PROGRESSION</p>
        {exp.highestLevel !== null && (
          <p className="text-xs tracking-widest text-zinc-400">Highest Level {exp.highestLevel}</p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="min-w-0 type-stat text-level">
          Level {exp.currentLevel}
        </h2>
        <span className="min-w-0 break-all font-mono text-sm text-zinc-400">
          {exp.currentExpText} EXP
        </span>
      </div>

      {exp.nextLevel === null ? (
        <p className="mt-4 text-sm font-medium tracking-widest text-amber-300/90">MAX LEVEL</p>
      ) : (
        <>
          <ProgressBar value={percent ?? 0} label={`Level ${exp.currentLevel} progress`}
            valueText={`${percent ?? 0} percent toward Level ${exp.nextLevel}, ${exp.expToNextText ?? ""} EXP remaining`}
            className="mt-5" />
          <p className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-zinc-400">
            <span>{percent ?? 0}%</span>
            <span className="min-w-0 break-all font-mono">
              {exp.expToNextText} EXP to Level {exp.nextLevel}
            </span>
          </p>
        </>
      )}
    </Card>
  );
}

export function ExpProgressCard({ exp }: { exp: ExpProgress }) {
  if (exp.state === "unavailable") return <ProgressionUnavailable />;
  if (exp.state === "invalid") return <ProgressionInvalid />;
  return <ProgressionAvailable exp={exp} />;
}
