/** Runtime validation supplements the authoritative database catalogue trigger. */
export function isSupportedTimezone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value !== value.trim() ||
      /^[+-]/.test(value) || /^(posix\/|right\/|localtime$)/i.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function timezoneOptions() {
  // ICU may list Asia/Saigon instead of Asia/Ho_Chi_Minh. Both remain valid names.
  // UTC is valid but is omitted from supportedValuesOf on some runtimes.
  return [...new Set([...Intl.supportedValuesOf("timeZone"), "UTC", "Asia/Ho_Chi_Minh"])]
    .filter(isSupportedTimezone).sort();
}
