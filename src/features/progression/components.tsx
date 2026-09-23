import type { ExpProgress } from "./numbers";

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={label}
      className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/80 p-6 [overflow-wrap:anywhere] shadow-[0_0_0_1px_rgba(255,255,255,0.02)_inset]"
    >
      {children}
    </section>
  );
}

export function PlayerSummary({ email, displayName }: { email: string; displayName: string | null }) {
  return (
    <Card label="Player status">
      <p className="text-xs font-medium tracking-[0.3em] text-zinc-400">PLAYER</p>
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
      <p className="text-xs font-medium tracking-[0.3em] text-zinc-400">PROGRESSION</p>
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
      <p className="text-xs font-medium tracking-[0.3em] text-zinc-400">PROGRESSION</p>
      <p role="alert" className="mt-3 break-words text-zinc-300">
        Progression data could not be read safely.
      </p>
      <p className="mt-1 text-sm text-zinc-400">Please try again from the dashboard.</p>
      <a
        href="/dashboard"
        className="mt-4 inline-block rounded-md border border-zinc-600 px-4 py-2 text-sm underline-offset-4 hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
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
        <p className="text-xs font-medium tracking-[0.3em] text-zinc-400">PROGRESSION</p>
        {exp.highestLevel !== null && (
          <p className="text-xs tracking-widest text-zinc-400">Highest Level {exp.highestLevel}</p>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="min-w-0 text-4xl font-bold tracking-tight text-amber-300">
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
          <div
            role="progressbar"
            aria-label={`Level ${exp.currentLevel} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? 0}
            aria-valuetext={`${percent ?? 0} percent toward Level ${exp.nextLevel}, ${exp.expToNextText ?? ""} EXP remaining`}
            className="mt-5 h-2 w-full overflow-hidden rounded-full bg-zinc-800"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300"
              style={{ width: `${percent ?? 0}%` }}
            />
          </div>
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
