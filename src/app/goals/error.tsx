"use client";

import { goalButton } from "@/features/goals/components";

export default function GoalsError({ reset }: { reset: () => void }) {
  return <main className="mx-auto w-full max-w-2xl page-frame">
    <h1 className="text-3xl font-semibold">Goals unavailable</h1>
    <p role="alert" className="mt-4">Current Main Quest progress could not be read. Your saved requests remain available for recovery.</p>
    <button className={`${goalButton} mt-4`} onClick={reset}>Retry Goals</button>
    <a className={`${goalButton} ml-2 mt-4`} href="/goals">Reload Goals</a>
  </main>;
}
