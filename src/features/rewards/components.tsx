import type { RewardsResult } from "./model";

const PREVIEW_SIZE = 5;
const linkClass = "mt-4 inline-block rounded-md border border-zinc-600 px-4 py-2 text-sm underline-offset-4 hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
const lifecycleLabels = { LOCKED: "Locked", UNLOCKED: "Unlocked", REDEEMED: "Redeemed" };

function RewardsCard({ children, loading = false }: { children: React.ReactNode; loading?: boolean }) {
  return <section aria-label="Rewards Preview" aria-busy={loading}
    className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/80 p-4 [overflow-wrap:anywhere] sm:p-6">
    <h2 className="text-xs font-medium tracking-[0.3em] text-zinc-400">REWARDS PREVIEW</h2>
    {children}
  </section>;
}

export function RewardsLoading() {
  return <RewardsCard loading><p role="status" className="mt-4 text-zinc-400">Loading Rewards…</p></RewardsCard>;
}

export function RewardsPreview({ result }: { result: RewardsResult }) {
  let content: React.ReactNode;
  if (result.status === "session-expired") {
    content = <>
      <p role="alert" className="mt-4 text-zinc-300">Your session has expired. Sign in again to load Rewards.</p>
      <a href="/login" className={linkClass}>Sign in again</a>
    </>;
  } else if (result.status !== "ok") {
    content = <>
      <p role="alert" className="mt-4 text-zinc-300">{result.status === "invalid"
        ? "Reward data could not be read safely. Please try again."
        : "Rewards are unavailable right now. Please try again."}</p>
      {/* Full navigation reruns authenticated server reads, bypassing client route cache. */}
      <a href="/dashboard" className={linkClass}>Retry Rewards</a>
    </>;
  } else if (result.rewards.length === 0) {
    content = <p role="status" className="mt-4 text-zinc-300">No rewards configured yet.</p>;
  } else {
    content = <>
      <ul aria-label="Rewards" className="mt-5 space-y-3">
        {result.rewards.slice(0, PREVIEW_SIZE).map((reward) => <li key={reward.reward_id}
          className="min-w-0 rounded-md border border-zinc-800 bg-zinc-900/40 p-4">
          <h3 className="font-medium text-zinc-100">{reward.title}</h3>
          <dl className="mt-3 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-zinc-400">Required Level</dt><dd className="mt-1 font-mono text-amber-300">{reward.required_level}</dd></div>
            <div><dt className="text-zinc-400">Status</dt><dd className="mt-1 text-zinc-200">{lifecycleLabels[reward.lifecycle]}</dd></div>
          </dl>
          {reward.archived_at !== null && <p className="mt-3 text-sm text-zinc-400">Archived</p>}
        </li>)}
      </ul>
      <p className="mt-4 text-xs text-zinc-400">Showing {Math.min(PREVIEW_SIZE, result.rewards.length)} of {result.rewards.length} rewards.</p>
    </>;
  }
  return <RewardsCard>{content}</RewardsCard>;
}
