"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js`, the minimal static-asset service worker.
 *
 * Production only: development and the disposable E2E runs stay free of a second
 * caching layer. The worker never serves application code, HTML, Server Action/RPC
 * responses or Supabase traffic, so registration cannot hand out stale data; a fresh
 * navigation still reads the current build.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    let cancelled = false;

    async function register() {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        // Activate an update as soon as it is installed instead of waiting for every
        // tab to close. Only the small static allowlist is cached, so no page reload
        // is required and no stale application code can be served.
        const activate = (worker: ServiceWorker | null) => worker?.postMessage("SKIP_WAITING");
        activate(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed") activate(registration.waiting);
          });
        });
      } catch {
        // Installability is an enhancement: a registration failure must not affect
        // authentication, navigation or any Quest/EXP behavior.
      }
    }

    if (!cancelled) void register();
    return () => { cancelled = true; };
  }, []);

  return null;
}
