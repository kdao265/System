"use client";

import { useActionState } from "react";
import { saveProfile } from "./actions";

export function OnboardingForm({ displayName, timezones }: { displayName: string | null; timezones: string[] }) {
  const [state, action, pending] = useActionState(saveProfile, {});
  const controlClass = "mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
  return (
    <form action={action} className="mt-8 space-y-5" aria-busy={pending}>
      <div>
        <label htmlFor="display_name">Display name <span className="text-sm text-zinc-400">(optional)</span></label>
        <input id="display_name" name="display_name" autoComplete="nickname" defaultValue={displayName ?? ""} className={controlClass} />
      </div>
      <div>
        <label htmlFor="timezone">Timezone</label>
        <select id="timezone" name="timezone" defaultValue="" required aria-describedby="timezone-help" className={controlClass}>
          <option value="" disabled>Select your timezone</option>
          {timezones.map((timezone) => <option key={timezone} value={timezone}>{timezone}</option>)}
        </select>
        <p id="timezone-help" className="mt-2 text-sm text-zinc-400">Choose your timezone to finish setup. No timezone is selected automatically.</p>
      </div>
      <div aria-live="polite" aria-atomic="true">
        {state.error && <p role="alert" className="text-sm text-red-300">{state.error}</p>}
      </div>
      <button disabled={pending} className="w-full rounded-md bg-zinc-100 px-4 py-2 font-medium text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:opacity-50">
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
