import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "./config";

export async function createServerSupabaseClient(readOnly = false) {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseConfig();

  // Each request gets its own client; never share session state between users.
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        // Server Components cannot write cookies. Proxy refreshes before rendering.
        // Actions use the writable default so cookie failures are not swallowed.
        if (readOnly) return;
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options),
        );
      },
    },
  });
}

// Password attempts get isolated storage. A rejected identity's tokens must never
// reach response cookies, even when remote session revocation is unavailable.
export async function createPasswordLoginClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseConfig();
  const pending = new Map<string, { value: string; options: CookieOptions }>();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [],
      setAll: (values) => values.forEach(({ name, value, options }) => pending.set(name, { value, options })),
    },
  });
  const cookieName = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  function discard() {
    for (const { name } of cookieStore.getAll()) {
      if (name === cookieName || name.startsWith(`${cookieName}.`) || name === `${cookieName}-code-verifier`) {
        cookieStore.set(name, "", { path: "/", sameSite: "lax", maxAge: 0 });
      }
    }
  }
  return {
    supabase,
    discard,
    commit() {
      discard();
      pending.forEach(({ value, options }, name) => cookieStore.set(name, value, options));
    },
  };
}
