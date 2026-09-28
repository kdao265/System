// Pure guards: never echo the rejected configuration (it may contain credentials).
export function requireLoopbackOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" ||
      !url.port || Number(url.port) < 1024 || url.origin !== value) throw new Error();
    return url.origin;
  } catch {
    throw new Error("E2E requires a generated loopback origin with an explicit unprivileged port");
  }
}

export function requireE2ERuntime(runtime) {
  if (!runtime || !runtime.owner ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runtime.owner.id ?? "") ||
    !/^auth-[a-f0-9-]+@example\.invalid$/.test(runtime.owner.email ?? "") ||
    !/^[a-f0-9]{48}Aa1!$/.test(runtime.owner.password ?? "")) {
    throw new Error("E2E requires a generated disposable owner");
  }
  const origins = [requireLoopbackOrigin(runtime.app), requireLoopbackOrigin(runtime.url)];
  if (origins[0] === origins[1]) throw new Error("E2E app and gateway must be separate disposable services");
  return origins;
}
