import { createServerClient } from "@supabase/ssr";
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
