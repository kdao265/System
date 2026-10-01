// UI copy only. Never translate route segments, persisted values or command identifiers.
export const en = {
  navigation: { label: "SYSTEM navigation", dashboard: "Dashboard", calendar: "Calendar", goals: "Goals / Main Quests" },
  shell: { dashboard: "Purposeful action. Steady progress.", calendar: "Your time, alongside your Quests.", goals: "Give your Quests a shared direction." },
  locale: { label: "Language", apply: "Apply language", hint: "Applies to navigation and page titles.", unavailable: "Language could not be saved. Allow cookies and try again." },
  common: { edit: "Edit", archive: "Archive", restore: "Restore", retry: "Retry", empty: "Nothing here yet." },
  quest: { complete: "Complete", reopen: "Reopen" },
  calendar: { day: "Day", week: "Week", month: "Month" },
  goal: { mainQuest: "Main Quest", subQuest: "Sub Quest" },
} as const;

type DictionaryShape<T> = { readonly [K in keyof T]: T[K] extends string ? string : DictionaryShape<T[K]> };
export type Dictionary = DictionaryShape<typeof en>;

export const vi = {
  navigation: { label: "Điều hướng SYSTEM", dashboard: "Tổng quan", calendar: "Lịch", goals: "Mục tiêu / Main Quest" },
  shell: { dashboard: "Hành động có chủ đích. Tiến bộ mỗi ngày.", calendar: "Thời gian của bạn, cùng các Quest.", goals: "Kết nối các Quest với một mục tiêu chung." },
  locale: { label: "Ngôn ngữ", apply: "Áp dụng ngôn ngữ", hint: "Áp dụng cho điều hướng và tiêu đề trang.", unavailable: "Không lưu được ngôn ngữ. Hãy cho phép cookie rồi thử lại." },
  common: { edit: "Chỉnh sửa", archive: "Lưu trữ", restore: "Khôi phục", retry: "Thử lại", empty: "Chưa có nội dung." },
  quest: { complete: "Hoàn thành", reopen: "Mở lại" },
  calendar: { day: "Ngày", week: "Tuần", month: "Tháng" },
  goal: { mainQuest: "Main Quest", subQuest: "Sub Quest" },
} satisfies Dictionary;

export type Locale = "vi" | "en";
export const DEFAULT_LOCALE: Locale = "vi";
export const LOCALE_COOKIE = "system-locale";
export function resolveLocale(value: unknown): Locale {
  return value === "en" || value === "vi" ? value : DEFAULT_LOCALE;
}
export function getDictionary(value: unknown): Dictionary {
  return resolveLocale(value) === "en" ? en : vi;
}

// This preference contains no authentication or user data; reject arbitrary cookie values.
export function localeCookie(value: Locale, secure: boolean): string {
  return `${LOCALE_COOKIE}=${resolveLocale(value)}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? "; Secure" : ""}`;
}
