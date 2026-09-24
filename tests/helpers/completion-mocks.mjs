// External service/browser boundaries only. Reset explicitly before every test.
export let account;
export let response;
export let invalidateThrows;
export let refreshCallback;
export const calls = [];
export const invalidations = [];
export const authCallbacks = new Set();
export function configure(next, owner, throwing = false) {
  response = next; account = owner; invalidateThrows = throwing;
  calls.length = 0; invalidations.length = 0;
  refreshCallback = () => {};
}
export function setRefresh(callback) { refreshCallback = callback; }
export async function requireUser() { if (!account) throw Error("expired"); return { id: account }; }
export async function createServerSupabaseClient() {
  return { rpc: async (name, args) => { calls.push({ name, args }); return response(name, args); } };
}
export function revalidatePath(...args) {
  if (invalidateThrows) throw Error("cache unavailable");
  invalidations.push(args);
}
export function useRouter() { return { refresh: () => refreshCallback() }; }
export function createSupabaseClient() {
  return { auth: { onAuthStateChange(callback) {
    authCallbacks.add(callback);
    return { data: { subscription: { unsubscribe() { authCallbacks.delete(callback); } } } };
  } } };
}
