"use client";

import { useSyncExternalStore } from "react";

function subscribe(notify: () => void) {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

// A browser hint, not proof of server reachability. Reconnect never sends work.
export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

export function NetworkStatus() {
  const online = useOnline();
  return <div role="status" aria-live="polite" aria-atomic="true">
    {!online && <p className="border-b border-amber-800 bg-amber-950 px-6 py-3 text-sm text-amber-100 [padding-top:max(0.75rem,env(safe-area-inset-top))] [padding-left:max(1.5rem,env(safe-area-inset-left))] [padding-right:max(1.5rem,env(safe-area-inset-right))]">
      You are offline. Displayed data may be out of date. Reconnect before signing in, signing out or changing Quests. Saved requests will not be sent automatically.
    </p>}
  </div>;
}
