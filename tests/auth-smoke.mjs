// Local-only HTTP integration test. Run against `npm run start -- --port 3100`:
// node --env-file=.env.local tests/auth-smoke.mjs
// Creates one synthetic Auth user (and trigger-owned profile), retained locally.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";

const app = "http://localhost:3100";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert(url && key, "Local Supabase configuration is required");
assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname), "Remote Supabase is prohibited");

const jar = new Map();
const email = `auth-smoke-${randomUUID()}@example.com`;
const password = `${randomUUID()}Aa1!`;
const check = (condition, message) => assert(condition, message);

async function request(path, options = {}) {
  const response = await fetch(app + path, {
    ...options,
    redirect: "manual",
    headers: { Origin: app, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...options.headers },
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";", 1)[0];
    const index = pair.indexOf("=");
    const name = pair.slice(0, index);
    const value = pair.slice(index + 1);
    if (!value || /max-age=0(?:;|$)/i.test(cookie)) jar.delete(name);
    else jar.set(name, value);
  }
  return { response, html: await response.text() };
}

const decode = (text) => text.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

async function submit(path, fields) {
  const { html } = await request(path);
  const body = new FormData();
  for (const tag of html.matchAll(/<input\b[^>]*>/g)) {
    const attrs = Object.fromEntries([...tag[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]));
    if (attrs.type === "hidden" && attrs.name) body.append(attrs.name, attrs.value ?? "");
  }
  check([...body.keys()].some((k) => k.startsWith("$ACTION_")), "Server-rendered action form missing");
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return request(path, { method: "POST", body });
}

function redirectTo(result, path) {
  check([303, 307].includes(result.response.status) && result.response.headers.get("location") === path, `Expected redirect to ${path}`);
}

try {
  check((await request("/")).response.status === 200, "Public home failed");
  redirectTo(await request("/dashboard"), "/login");
  check((await request("/login")).response.status === 200, "Login unavailable");
  check((await request("/signup")).response.status === 200, "Signup unavailable");
  console.log("PASS: public routes and unauthenticated dashboard protection");

  check((await submit("/signup", { email, password, confirmPassword: "mismatch" })).html.includes("Passwords must match."), "Mismatch feedback missing");
  check((await submit("/login", { email: "", password: "" })).html.includes("Enter your email and password."), "Required validation missing");
  check((await submit("/login", { email, password })).html.includes("Unable to sign in."), "Safe invalid-credentials feedback missing");
  console.log("PASS: server-side required/matching validation and safe login failure");

  const registered = await submit("/signup", { email, password, confirmPassword: password });
  if (registered.html.includes("Signup request received.")) {
    check(!jar.size || ![...jar.keys()].some((k) => /auth-token(?:\.\d+)?$/.test(k)), "Pending signup must not create a session");
    redirectTo(await request("/dashboard"), "/login");
    console.log("PASS: confirmation-pending signup stays unauthenticated; confirm email before testing login/logout");
    process.exit(0);
  }
  redirectTo(registered, "/dashboard");
  const dashboard = await request("/dashboard");
  check(dashboard.html.includes(email) && dashboard.html.includes("SYSTEM V1"), "Verified identity missing");
  check(dashboard.response.headers.get("cache-control")?.includes("no-store"), "Private response must not be cached");
  redirectTo(await request("/login"), "/dashboard");
  redirectTo(await request("/signup"), "/dashboard");
  console.log("PASS: signup session, dashboard identity, private caching and authenticated redirects");

  const client = createServerClient(url, key, { cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (cookies) => cookies.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
  } });
  const { data: identity, error: identityError } = await client.auth.getUser();
  check(!identityError && identity.user, "Auth identity verification failed");
  const { data: profiles, error: profileError } = await client.from("profiles").select("user_id,display_name,timezone");
  check(!profileError && profiles?.length === 1 && profiles[0].user_id === identity.user.id && profiles[0].display_name === null && profiles[0].timezone === null, "Trigger-owned private profile missing or incorrectly initialized");
  console.log("PASS: exactly one owner-visible profile, optional fields null; no application insert");

  // Expire the SDK's stored expiry to force the real proxy refresh path.
  const parts = [...jar].filter(([name]) => /auth-token(?:\.\d+)?$/.test(name)).sort(([a], [b]) => a.localeCompare(b));
  check(parts.length > 0, "Session cookies missing");
  const encoded = parts.map(([, value]) => value).join("");
  check(encoded.startsWith("base64-"), "Unexpected SSR cookie encoding");
  const session = JSON.parse(Buffer.from(encoded.slice(7), "base64url").toString());
  session.expires_at = 1;
  parts.forEach(([name]) => jar.delete(name));
  const baseName = parts[0][0].replace(/\.\d+$/, "");
  jar.set(baseName, "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url"));
  const refreshed = await request("/dashboard");
  check(refreshed.html.includes(email) && refreshed.response.headers.getSetCookie().some((v) => v.startsWith(baseName)), "Proxy failed to refresh the session");
  check((await request("/dashboard")).html.includes(email), "Refreshed cookies did not survive the next request");
  console.log("PASS: proxy refresh writes cookies and preserves the next authenticated request");

  redirectTo(await submit("/dashboard", {}), "/login");
  check(![...jar.keys()].some((k) => /auth-token(?:\.\d+)?$/.test(k)), "Logout did not clear session cookies");
  redirectTo(await request("/dashboard"), "/login");
  redirectTo(await submit("/login", { email, password }), "/dashboard");
  check((await request("/dashboard")).html.includes(email), "Password login failed");
  redirectTo(await submit("/dashboard", {}), "/login");
  console.log("PASS: logout clears cookies and protects dashboard; password login succeeds");
  console.log("Local synthetic Auth user/profile retained. No credentials printed.");
} catch (error) {
  // Avoid dumping responses, cookie jars or SDK objects on a failed assertion.
  console.error(error instanceof assert.AssertionError ? error.message : "Local smoke test failed; check local service availability.");
  process.exitCode = 1;
}
