// Local-only HTTP integration test. Run against `npm run start -- --port 3100`:
// node --env-file=.env.local tests/auth-smoke.mjs
// Creates two synthetic Auth users (and trigger-owned profiles), retained locally.
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
  const form = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/)?.[0] ?? "";
  for (const tag of form.matchAll(/<input\b[^>]*>/g)) {
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
  redirectTo(await request("/onboarding"), "/login");
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
  redirectTo(await request("/dashboard"), "/onboarding");
  redirectTo(await request("/login"), "/onboarding");
  redirectTo(await request("/signup"), "/onboarding");
  const setup = await request("/onboarding");
  check(setup.html.includes("Profile Setup") && setup.html.includes('value="Asia/Ho_Chi_Minh"'), "Setup or required timezone option missing");
  check(/<option[^>]*value=""[^>]*selected/.test(setup.html), "Timezone must start with an explicit empty selection");
  console.log("PASS: incomplete user routes to onboarding with no timezone default");

  const client = createServerClient(url, key, { cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (cookies) => cookies.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
  } });
  const { data: identity, error: identityError } = await client.auth.getUser();
  check(!identityError && identity.user, "Auth identity verification failed");
  const { data: profiles, error: profileError } = await client.from("profiles").select("user_id,display_name,timezone,created_at,updated_at");
  check(!profileError && profiles?.length === 1 && profiles[0].user_id === identity.user.id && profiles[0].display_name === null && profiles[0].timezone === null, "Trigger-owned private profile missing or incorrectly initialized");
  console.log("PASS: exactly one owner-visible profile, optional fields null; no application insert");

  for (const timezone of ["", "Not/A_Zone", "+07:00", " UTC", "posix/UTC", "localtime"]) {
    const result = await submit("/onboarding", { display_name: "Unsaved", timezone });
    check(result.html.includes("Select a valid IANA timezone"), "Invalid timezone was not rejected safely");
  }
  // Intl is case-insensitive; the database requires an exact catalogue name.
  check((await submit("/onboarding", { display_name: "Unsaved", timezone: "utc" })).html.includes("Unable to save your profile."), "Database rejection was not handled safely");
  const beforeSave = await client.from("profiles").select("display_name,timezone").single();
  check(beforeSave.data?.display_name === null && beforeSave.data?.timezone === null, "Rejected updates modified the profile");

  const otherJar = new Map();
  const other = createServerClient(url, key, { cookies: {
    getAll: () => [...otherJar].map(([name, value]) => ({ name, value })),
    setAll: (cookies) => cookies.forEach(({ name, value }) => otherJar.set(name, value)),
  } });
  const otherSignup = await other.auth.signUp({ email: `profile-isolation-${randomUUID()}@example.com`, password: `${randomUUID()}Aa1!` });
  check(!otherSignup.error && otherSignup.data.session && otherSignup.data.user, "Isolation fixture signup failed");
  const otherId = otherSignup.data.user.id;
  const crossUser = await client.from("profiles").update({ display_name: "Forbidden" }).eq("user_id", otherId).select("user_id");
  check(!crossUser.error && crossUser.data?.length === 0, "RLS allowed a cross-user update");

  redirectTo(await submit("/onboarding", {
    display_name: "   ", timezone: "Asia/Ho_Chi_Minh", user_id: otherId,
    created_at: "2000-01-01T00:00:00Z", updated_at: "2000-01-01T00:00:00Z",
  }), "/dashboard");
  const saved = await client.from("profiles").select("user_id,display_name,timezone,created_at,updated_at").single();
  check(saved.data?.user_id === identity.user.id && saved.data?.display_name === null && saved.data?.timezone === "Asia/Ho_Chi_Minh", "Owner save/optional name normalization failed");
  check(saved.data.created_at === profiles[0].created_at && Date.parse(saved.data.updated_at) >= Date.parse(profiles[0].updated_at) && Date.parse(saved.data.updated_at) !== Date.parse("2000-01-01T00:00:00Z"), "Browser timestamp fields were trusted");
  const otherProfile = await other.from("profiles").select("display_name,timezone").single();
  check(otherProfile.data?.display_name === null && otherProfile.data?.timezone === null, "Forged ownership changed another profile");
  await other.auth.signOut({ scope: "local" });
  console.log("PASS: safe timezone rejection, optional name, RLS isolation and ignored browser ownership/timestamps");

  // Owner clearing timezone through existing RLS must restore the same gate.
  const cleared = await client.from("profiles").update({ timezone: null }).eq("user_id", identity.user.id);
  check(!cleared.error, "Owner timezone clear failed");
  redirectTo(await request("/dashboard"), "/onboarding");
  redirectTo(await submit("/onboarding", { display_name: "  Profile Tester  ", timezone: "Asia/Ho_Chi_Minh" }), "/dashboard");
  const named = await client.from("profiles").select("display_name").single();
  check(named.data?.display_name === "Profile Tester", "Display name was not trimmed");
  const dashboard = await request("/dashboard");
  check(dashboard.html.includes(email) && dashboard.html.includes("Profile Tester") && dashboard.html.includes("Asia/Ho_Chi_Minh"), "Dashboard identity/profile missing");
  check(dashboard.response.headers.get("cache-control")?.includes("no-store"), "Private response must not be cached");
  redirectTo(await request("/login"), "/dashboard");
  redirectTo(await request("/signup"), "/dashboard");
  redirectTo(await request("/onboarding"), "/dashboard");
  console.log("PASS: completed-user redirects, saved name/timezone and re-gating after timezone clearing");

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
  console.log("Two local synthetic Auth users/profiles retained. No credentials printed.");
} catch (error) {
  // Avoid dumping responses, cookie jars or SDK objects on a failed assertion.
  console.error(error instanceof assert.AssertionError ? error.message : "Local smoke test failed; check local service availability.");
  process.exitCode = 1;
}
