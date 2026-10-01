// Self-contained disposable integration. Run: node tests/auth-smoke.mjs
import assert from "node:assert/strict";
import { createServerClient } from "@supabase/ssr";
import { startAuthEnvironment } from "./helpers/auth-environment.mjs";

const env = await startAuthEnvironment();
let app;
const { url, key, owner, other: outsider } = env;
// Existing feature-copy assertions run in an explicit supported locale.
const jar = new Map([["system-locale", "en"]]);
const { email, password } = owner;
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

async function actionBody(path, fields, logout = false) {
  const { html } = await request(path);
  const body = new FormData();
  const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)].map(([form]) => form);
  const form = (logout ? forms.find((form) => form.includes("Sign out")) : forms[0]) ?? "";
  for (const tag of form.matchAll(/<input\b[^>]*>/g)) {
    const attrs = Object.fromEntries([...tag[0].matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]));
    if (attrs.type === "hidden" && attrs.name) body.append(attrs.name, attrs.value ?? "");
  }
  check([...body.keys()].some((k) => k.startsWith("$ACTION_")), "Server-rendered action form missing");
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  return body;
}

async function submit(path, fields, logout = false) {
  return request(path, { method: "POST", body: await actionBody(path, fields, logout) });
}

function redirectTo(result, path) {
  check([303, 307].includes(result.response.status) && result.response.headers.get("location") === path, `Expected redirect to ${path}`);
}

try {
  app = await env.startApp();
  check((await request("/")).response.status === 200, "Public home failed");
  redirectTo(await request("/dashboard"), "/login");
  redirectTo(await request("/calendar"), "/login");
  redirectTo(await request("/goals"), "/login");
  redirectTo(await request("/onboarding"), "/login");
  check((await request("/login")).response.status === 200, "Login unavailable");
  redirectTo(await request("/signup"), "/login");
  check(!(await request("/login")).html.includes('href="/signup"'), "Login exposes signup");
  console.log("PASS: public routes and unauthenticated dashboard protection");

  check((await submit("/login", { email: "", password: "" })).html.includes("Enter your email and password."), "Required validation missing");
  check((await submit("/login", { email, password: "invalid-password" })).html.includes("Unable to sign in."), "Safe invalid-credentials feedback missing");
  check((await submit("/login", { email: outsider.email, password: outsider.password })).html.includes("Unable to sign in."), "Non-owner login not rejected");
  check(![...jar.keys()].some((key) => /auth-token(?:\.\d+)?$/.test(key)), "Rejected login left session cookies");
  redirectTo(await request("/dashboard"), "/login");
  redirectTo(await request("/calendar"), "/login");
  redirectTo(await request("/goals"), "/login");
  const disabled = await fetch(url + "/auth/v1/signup", {
    method: "POST", redirect: "error", headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "disabled@example.invalid", password }),
  });
  check(!disabled.ok && (await disabled.json()).error_code === "signup_disabled", "Direct Auth signup must be disabled");
  const anonymous = await fetch(url + "/auth/v1/signup", {
    method: "POST", redirect: "error", headers: { apikey: key, "Content-Type": "application/json" }, body: "{}",
  });
  check(!anonymous.ok, "Anonymous Auth signup must be disabled");
  check(await env.sql("SELECT count(*) FROM auth.users;") === "2", "Disabled registration created an account");
  console.log("PASS: disabled signup, invalid credentials and non-owner login rejection without session cookies");
  const registered = await submit("/login", { email, password });
  redirectTo(registered, "/dashboard");
  redirectTo(await request("/dashboard"), "/onboarding");
  redirectTo(await request("/calendar"), "/onboarding");
  redirectTo(await request("/goals"), "/onboarding");
  redirectTo(await request("/login"), "/onboarding");
  redirectTo(await request("/signup"), "/login");
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
  const otherLogin = await other.auth.signInWithPassword({ email: outsider.email, password: outsider.password });
  check(!otherLogin.error && otherLogin.data.session, "Non-owner direct session fixture failed");
  const otherId = outsider.id;
  // Replay an owner-rendered Server Action with anonymous and real non-owner cookies.
  const forgedAction = await actionBody("/onboarding", { display_name: "Forbidden", timezone: "UTC" });
  const ownerCookies = new Map(jar);
  jar.clear();
  redirectTo(await request("/onboarding", { method: "POST", body: forgedAction }), "/login");
  otherJar.forEach((value, name) => jar.set(name, value));
  redirectTo(await request("/dashboard"), "/login");
  redirectTo(await request("/calendar"), "/login");
  redirectTo(await request("/goals"), "/login");
  redirectTo(await request("/onboarding"), "/login");
  redirectTo(await request("/onboarding", { method: "POST", body: forgedAction }), "/login");
  const rejectedAgain = await submit("/login", { email: outsider.email, password: outsider.password });
  check(rejectedAgain.html.includes("Unable to sign in."), "Existing non-owner session bypassed login");
  check(![...jar.keys()].some((key) => /auth-token(?:\.\d+)?$/.test(key)), "Rejected login retained existing non-owner cookies");
  jar.clear(); ownerCookies.forEach((value, name) => jar.set(name, value));
  console.log("PASS: direct non-owner session denied protected pages and replayed Profile action; anonymous action denied");
  const crossUser = await client.from("profiles").update({ display_name: "Forbidden" }).eq("user_id", otherId).select("user_id");
  check(!crossUser.error && crossUser.data?.length === 0, "RLS allowed a cross-user update");

  redirectTo(await submit("/onboarding", {
    display_name: "   ", timezone: "Asia/Ho_Chi_Minh", user_id: otherId,
    created_at: "2000-01-01T00:00:00Z", updated_at: "2000-01-01T00:00:00Z",
  }), "/dashboard");
  const saved = await client.from("profiles").select("user_id,display_name,timezone,created_at,updated_at").single();
  check(saved.data?.user_id === identity.user.id && saved.data?.display_name === null && saved.data?.timezone === "Asia/Ho_Chi_Minh", "Owner save/optional name normalization failed");
  check(saved.data.created_at === profiles[0].created_at && Date.parse(saved.data.updated_at) >= Date.parse(profiles[0].updated_at) && Date.parse(saved.data.updated_at) !== Date.parse("2000-01-01T00:00:00Z"), "Browser timestamp fields were trusted");
  const otherProfile = await other.from("profiles").select("display_name,timezone");
  check(!otherProfile.error && otherProfile.data?.length === 0, "Non-owner profile must be hidden by restrictive RLS");
  check(await env.sql(`SELECT display_name IS NULL AND timezone IS NULL FROM public.profiles WHERE user_id = '${otherId}';`) === "t", "Forged ownership changed another profile");
  const directRpc = await other.rpc("get_current_exp");
  check(directRpc.error?.code === "42501", "Non-owner direct RPC must be denied");
  console.log("PASS: activated database RLS hides non-owner data and rejects direct non-owner RPCs");
  await other.auth.signOut({ scope: "local" });
  console.log("PASS: safe timezone rejection, optional name, RLS isolation and ignored browser ownership/timestamps");

  // Owner clearing timezone through existing RLS must restore the same gate.
  const cleared = await client.from("profiles").update({ timezone: null }).eq("user_id", identity.user.id);
  check(!cleared.error, "Owner timezone clear failed");
  redirectTo(await request("/dashboard"), "/onboarding");
  redirectTo(await request("/calendar"), "/onboarding");
  redirectTo(await request("/goals"), "/onboarding");
  redirectTo(await submit("/onboarding", { display_name: "  Profile Tester  ", timezone: "Asia/Ho_Chi_Minh" }), "/dashboard");
  const named = await client.from("profiles").select("display_name").single();
  check(named.data?.display_name === "Profile Tester", "Display name was not trimmed");
  const dashboard = await request("/dashboard");
  check(dashboard.html.includes(email) && dashboard.html.includes("Profile Tester") && dashboard.html.includes("Asia/Ho_Chi_Minh"), "Dashboard identity/profile missing");
  check(dashboard.response.headers.get("cache-control")?.includes("no-store"), "Private response must not be cached");
  redirectTo(await request("/login"), "/dashboard");
  redirectTo(await request("/signup"), "/login");
  redirectTo(await request("/onboarding"), "/dashboard");
  const goals = await request("/goals");
  check(goals.response.status === 200 && goals.html.includes("Goals / Main Quests"), "Owner Goals route failed");
  check(goals.response.headers.get("cache-control")?.includes("no-store"), "Goals response must not be cached");
  console.log("PASS: completed-user redirects, saved name/timezone, protected Goals and re-gating after timezone clearing");

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

  redirectTo(await submit("/dashboard", {}, true), "/login");
  check(![...jar.keys()].some((k) => /auth-token(?:\.\d+)?$/.test(k)), "Logout did not clear session cookies");
  redirectTo(await request("/dashboard"), "/login");
  redirectTo(await request("/calendar"), "/login");
  redirectTo(await request("/goals"), "/login");
  redirectTo(await submit("/login", { email, password }), "/dashboard");
  check((await request("/dashboard")).html.includes(email), "Password login failed");
  redirectTo(await submit("/dashboard", {}, true), "/login");
  console.log("PASS: logout clears cookies and protects dashboard; password login succeeds");
  // Reuse the production build, but change runtime server-only configuration.
  const configuredApp = app;
  redirectTo(await submit("/login", { email, password }), "/dashboard");
  const activeOwnerCookies = new Map(jar);
  check((await request("/dashboard")).html.includes(email), "Configuration checks require a valid owner session");
  jar.clear();
  for (const ownerSetting of ["", "not-a-uuid"]) {
    app = await env.startApp(ownerSetting);
    redirectTo(await request("/dashboard"), "/login");
    redirectTo(await request("/calendar"), "/login");
    redirectTo(await request("/goals"), "/login");
    check((await submit("/login", { email, password })).html.includes("Unable to sign in."), "Bad configuration permitted login");
    check(![...jar.keys()].some((key) => /auth-token(?:\.\d+)?$/.test(key)), "Bad configuration wrote a session");
    activeOwnerCookies.forEach((value, name) => jar.set(name, value));
    redirectTo(await request("/dashboard"), "/login");
    redirectTo(await request("/calendar"), "/login");
    redirectTo(await request("/goals"), "/login");
    redirectTo(await request("/onboarding", { method: "POST", body: forgedAction }), "/login");
    jar.clear();
  }
  app = configuredApp;
  console.log("PASS: missing and invalid runtime owner configuration deny login, existing session and Profile action");
} catch (error) {
  // Avoid dumping responses, cookie jars or SDK objects on a failed assertion.
  console.error(error instanceof assert.AssertionError ? error.message : "Local smoke test failed; check local service availability.");
  process.exitCode = 1;
} finally {
  await env.close();
  console.log("Disposable auth containers and network removed; existing Local and Cloud untouched.");
}
