// Phase 2A wire-test stand-in for src/lib/supabase/server.ts.
//
// The production module needs Next's request cookies, which do not exist in a plain
// Node process. This module is resolved in place of "@/lib/supabase/server" by
// supabase/tests/quest-completion-resolution-wire.mjs only. It still calls the real
// @supabase/ssr createServerClient with the same auth options, the same
// getAll/setAll cookie contract and the same X-Client-Info header that
// createServerClient sends in production; only the runtime URL and the session
// cookie contents are supplied by the test run. No PostgREST client, fetch
// wrapper, URL builder or response validator is replaced here.
import { createServerClient } from "@supabase/ssr";

let settings = null;
let currentIdentity = null;
const sessionCookies = new Map();
const clients = new Map();

/** Point the injectable client at one disposable runtime. */
export function configureWireServer(options) {
  if (typeof options?.url !== "string" || typeof options?.anonKey !== "string" || typeof options?.cookieName !== "string") {
    throw new Error("Wire server client requires url, anonKey and cookieName");
  }
  settings = { url: options.url, anonKey: options.anonKey, cookieName: options.cookieName };
  clients.clear();
}

/** Encode one identity's session exactly as @supabase/ssr's default base64url cookie does. */
export function registerWireIdentity(identity, session) {
  if (typeof identity !== "string" || identity === "") throw new Error("Wire identity name is required");
  if (session === null) {
    sessionCookies.set(identity, null);
    return;
  }
  const payload = JSON.stringify(session);
  sessionCookies.set(identity, `base64-${Buffer.from(payload, "utf8").toString("base64url")}`);
}

/** Select the identity whose cookie the next client construction must read. */
export function selectWireIdentity(identity) {
  if (!sessionCookies.has(identity)) throw new Error(`Unknown wire identity: ${identity}`);
  currentIdentity = identity;
}

/**
 * Production-shaped server client: the session arrives through cookie storage, is
 * never refreshed or persisted to disk, and read-only clients drop cookie writes
 * exactly like a Server Component.
 */
export async function createServerSupabaseClient(readOnly = false) {
  if (!settings) throw new Error("Wire server client is not configured");
  if (currentIdentity === null) throw new Error("No wire identity selected");
  const cacheKey = `${currentIdentity}|${readOnly ? "read-only" : "writable"}`;
  if (!clients.has(cacheKey)) {
    const jar = new Map();
    const encoded = sessionCookies.get(currentIdentity);
    if (encoded !== null) jar.set(settings.cookieName, encoded);
    clients.set(cacheKey, createServerClient(settings.url, settings.anonKey, {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (cookiesToSet) => {
          if (readOnly) return;
          for (const { name, value } of cookiesToSet) {
            if (value) jar.set(name, value);
            else jar.delete(name);
          }
        },
      },
      cookieOptions: { name: settings.cookieName },
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        skipAutoInitialize: true,
      },
    }));
  }
  return clients.get(cacheKey);
}
