// UI copy only. Never translate route segments, persisted values or command identifiers.
export const en = {
  dashboard: {
    levelUnconfigured: "Progression status: not configured", levelInvalid: "Progression status: data error",
    loadingMain: "Loading Main Quest...", loadingCalendar: "Loading Calendar...", loadingRecurring: "Loading recurring Quests...",
    player: "Player status", operator: "Operator", overview: "Your next step starts here.",
    main: "Main Quest", mainEmpty: "Give your next chapter a direction.", mainEmptyHint: "Connect your Quests to a meaningful goal.",
    openGoal: "Open Main Quest", browseGoals: "Explore Goals", mainUnavailable: "Main Quest could not be loaded. Please try again.",
    subquests: "Sub Quests", progress: "Progress", completed: "Completed", pending: "Not completed", active: "Active",
    level: "Progression status", currentExp: "Current EXP", remaining: "EXP to Level", highest: "Highest Level", max: "MAX LEVEL",
    unconfigured: "Level system not configured.", invalidExp: "Progression data could not be read safely.",
    unavailableExp: "Progression status is unavailable right now. Please try again.",
    calendar: "Upcoming Calendar", calendarHint: "Selected day + next 6 days", openCalendar: "Open Calendar", calendarEmpty: "No events in this window.", calendarUnavailable: "Calendar could not be loaded. Please try again.",
    allDay: "All day", untimed: "No set time", event: "Event", quest: "Quest",
    recurring: "Recurring Quests", recurringHint: "Your repeatable steps forward.", daily: "Daily", weekly: "Weekly", monthly: "Monthly", paused: "Paused", recurringEmpty: "No recurring Quests yet.", recurringUnavailable: "Recurring Quests could not be loaded safely.", manageRecurring: "Manage recurring Quests", allRecurring: "All recurring definitions", addQuest: "Create Quest", quests: "Quests", tools: "Quest tools", rewards: "Rewards", legacyHint: "Creation, recovery and reward tools currently use English.",
  },
  daily: {
    title: "Daily Quests", heading: "DAILY QUESTS", selected: "Selected day", timezone: "Profile timezone", navigation: "Quest day navigation", previous: "Previous day", next: "Next day", today: "Today", viewPrevious: "View previous day", viewNext: "View next day", viewToday: "View today", previousUnavailable: "Previous day unavailable", nextUnavailable: "Next day unavailable", choose: "Choose date", view: "View", loading: "Loading Daily Quests...",
    timezoneError: "Daily Quests need a valid profile timezone. Select and save your timezone to continue.", repair: "Repair timezone", sessionError: "Your session has expired. Sign in again to load Daily Quests.", signIn: "Sign in again", invalid: "Daily Quest data could not be read safely. Please try again.", unavailable: "Daily Quests are unavailable right now. Please try again.", retry: "Retry Daily Quests", empty: "No Quests for this day.", occurrences: "Quest occurrences", status: "Status", recurring: "Recurring occurrence", scheduled: "Scheduled", deadline: "Deadline", reward: "Reward EXP snapshot", notSet: "Not set", readiness: "Completion readiness (server)", ready: "Ready to complete", notReady: "Not ready to complete", setup: "Level system setup required.", fresh: "Readiness reflects the latest server read.",
    states: { draft: "Draft", scheduled: "Scheduled", active: "Active", completed: "Completed", failed: "Failed", cancelled: "Cancelled" },
  },
  questControl: {
    complete: "Complete", reopen: "Reopen", cancel: "Cancel", confirmReopen: "Confirm reopen", retryReopen: "Retry exact reopen", reopening: "Reopening...", checkingReopen: "Checking reopen...", confirmPrompt: "Reopen this completed Quest and reverse its EXP?", reopened: "Reopen confirmed. Refresh this page to read the current Quest state.", earlier: "An earlier completion request is confirmed. Check Quest recovery for refresh or cleanup.", disposition: "This request needs no further completion retry. Review the retained evidence in Quest recovery and refresh this page.", confirming: "Confirming completion...", checking: "Checking completion...", resolution: "Check completion resolution",
  },
  recurringControl: { recurring: "Recurring", definitions: "Recurring definitions", pause: "Pause", resume: "Resume", confirming: "Confirming…", awaiting: "Awaiting confirmation", retry: "Retry exact pause/resume request", check: "Check recurrence recovery", from: "From", through: "through", monthDay: "day", hint: "Pause stops new occurrences. Existing occurrences and EXP history stay unchanged." },
  questManage: {
    actions: "Quest actions", archive: "Archive", restore: "Restore", delete: "Delete permanently", cancel: "Cancel",
    confirmArchive: "Confirm archive", confirmRestore: "Confirm restore", confirmDelete: "Delete permanently", working: "Working…",
    archivePrompt: "Archive this Quest? It leaves the active list, keeps its history and EXP, and can be restored later.",
    restorePrompt: "Restore this Quest to active views?",
    deletePrompt: "Permanently remove this Quest from SYSTEM? It cannot be restored. If it is currently completed, reopen it first so completion EXP is reversed. Immutable system audit history is retained.",
    reopenFirst: "Reopen this completed Quest before permanent deletion.",
    restoreReopenFirst: "Restore this Quest, then reopen it before permanent deletion.",
    recoveryTitle: "Quest management recovery", retryExact: "Retry exact request", checkRecovery: "Check recovery again",
    recoveryBlocked: "Quest recovery storage or tab coordination is unavailable or changed. Preserve saved requests and check recovery before continuing.",
    archivedSuccess: "Quest archived.", restoredSuccess: "Quest restored.", deletedSuccess: "Quest permanently removed.",
    account: "Your signed-in account changed. Refresh before continuing.",
    validation: "This Quest action is invalid. Refresh and try again.",
    completed: "Reopen this completed Quest before permanent deletion.",
    goal: "Detach this Quest from its Main Quest before permanent deletion.",
    recurring: "This action is for one-off Quests only. Use recurring Quest controls for recurring definitions.",
    deleted: "This Quest has already been permanently removed.",
    exp: "Quest EXP is not fully reversed yet. Reopen the completed Quest and refresh before deleting.",
    conflict: "This command conflicts with recorded Quest history. Refresh before trying another action.",
    stale: "This Quest changed or is no longer available. Refresh before continuing.",
    unknown: "Awaiting confirmation. The exact request is saved; retry it before starting another Quest management action.",
    archivedTitle: "Archived Quests", archivedHeading: "ARCHIVED QUESTS",
    archivedHint: "Archived one-off Quests stay out of active views but keep their history and EXP.",
    archivedEmpty: "No archived one-off Quests.", archivedAt: "Archived",
    loadingArchived: "Loading archived Quests...", unavailable: "Archived Quests could not be loaded safely.",
    session: "Your session expired. Sign in again to manage archived Quests.",
  },
  navigation: { label: "SYSTEM navigation", dashboard: "Dashboard", calendar: "Calendar", goals: "Goals / Main Quests" },
  shell: { dashboard: "Purposeful action. Steady progress.", calendar: "Your time, alongside your Quests.", goals: "Give your Quests a shared direction." },
  locale: { label: "Language", apply: "Apply language", hint: "Applies to navigation, page titles and Dashboard summaries.", unavailable: "Language could not be saved. Allow cookies and try again." },
  common: { edit: "Edit", archive: "Archive", restore: "Restore", retry: "Retry", empty: "Nothing here yet." },
  quest: { complete: "Complete", reopen: "Reopen" },
  calendar: { day: "Day", week: "Week", month: "Month" },
  goal: { mainQuest: "Main Quest", subQuest: "Sub Quest" },
} as const;

type DictionaryShape<T> = { readonly [K in keyof T]: T[K] extends string ? string : DictionaryShape<T[K]> };
export type Dictionary = DictionaryShape<typeof en>;

export const vi = {
  dashboard: {
    levelUnconfigured: "Trạng thái tiến trình: chưa thiết lập", levelInvalid: "Trạng thái tiến trình: lỗi dữ liệu",
    loadingMain: "Đang tải Main Quest...", loadingCalendar: "Đang tải lịch...", loadingRecurring: "Đang tải Quest định kỳ...",
    player: "Trạng thái người chơi", operator: "Người chơi", overview: "Bước tiếp theo bắt đầu từ đây.",
    main: "Main Quest", mainEmpty: "Định hướng cho chặng đường mới.", mainEmptyHint: "Kết nối các Quest với một mục tiêu ý nghĩa.",
    openGoal: "Mở Main Quest", browseGoals: "Khám phá mục tiêu", mainUnavailable: "Không tải được Main Quest. Vui lòng thử lại.",
    subquests: "Sub Quest", progress: "Tiến độ", completed: "Đã hoàn thành", pending: "Chưa hoàn thành", active: "Đang thực hiện",
    level: "Trạng thái tiến trình", currentExp: "EXP hiện tại", remaining: "EXP đến LEVEL", highest: "LEVEL cao nhất", max: "LEVEL TỐI ĐA",
    unconfigured: "Chưa thiết lập hệ thống LEVEL.", invalidExp: "Không thể đọc dữ liệu tiến trình an toàn.",
    unavailableExp: "Hiện không tải được tiến trình. Vui lòng thử lại.",
    calendar: "Lịch sắp tới", calendarHint: "Ngày đã chọn + 6 ngày tiếp theo", openCalendar: "Mở lịch", calendarEmpty: "Không có sự kiện trong khoảng này.", calendarUnavailable: "Không tải được lịch. Vui lòng thử lại.",
    allDay: "Cả ngày", untimed: "Chưa đặt giờ", event: "Sự kiện", quest: "Quest",
    recurring: "Quest định kỳ", recurringHint: "Những bước tiến đều đặn của bạn.", daily: "Hằng ngày", weekly: "Hằng tuần", monthly: "Hằng tháng", paused: "Tạm dừng", recurringEmpty: "Chưa có Quest định kỳ.", recurringUnavailable: "Không thể tải Quest định kỳ an toàn.", manageRecurring: "Quản lý Quest định kỳ", allRecurring: "Tất cả Quest định kỳ", addQuest: "Tạo Quest", quests: "Quest", tools: "Công cụ Quest", rewards: "Phần thưởng", legacyHint: "Công cụ tạo, khôi phục và phần thưởng hiện dùng tiếng Anh.",
  },
  daily: {
    title: "Quest trong ngày", heading: "QUEST TRONG NGÀY", selected: "Ngày đã chọn", timezone: "Múi giờ hồ sơ", navigation: "Điều hướng ngày Quest", previous: "Ngày trước", next: "Ngày sau", today: "Hôm nay", viewPrevious: "Xem ngày trước", viewNext: "Xem ngày sau", viewToday: "Xem hôm nay", previousUnavailable: "Không có ngày trước", nextUnavailable: "Không có ngày sau", choose: "Chọn ngày", view: "Xem", loading: "Đang tải Quest trong ngày...",
    timezoneError: "Quest trong ngày cần múi giờ hồ sơ hợp lệ. Hãy chọn và lưu múi giờ để tiếp tục.", repair: "Sửa múi giờ", sessionError: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để tải Quest.", signIn: "Đăng nhập lại", invalid: "Không thể đọc dữ liệu Quest an toàn. Vui lòng thử lại.", unavailable: "Hiện không tải được Quest trong ngày. Vui lòng thử lại.", retry: "Tải lại Quest trong ngày", empty: "Không có Quest cho ngày này.", occurrences: "Các Quest trong ngày", status: "Trạng thái", recurring: "Quest định kỳ", scheduled: "Lịch thực hiện", deadline: "Hạn chót", reward: "EXP thưởng đã chốt", notSet: "Chưa đặt", readiness: "Khả năng hoàn thành (máy chủ)", ready: "Sẵn sàng hoàn thành", notReady: "Chưa sẵn sàng hoàn thành", setup: "Cần thiết lập hệ thống LEVEL.", fresh: "Trạng thái dựa trên lần đọc máy chủ gần nhất.",
    states: { draft: "Bản nháp", scheduled: "Đã lên lịch", active: "Đang thực hiện", completed: "Đã hoàn thành", failed: "Thất bại", cancelled: "Đã hủy" },
  },
  questControl: {
    complete: "Hoàn thành", reopen: "Mở lại", cancel: "Hủy", confirmReopen: "Xác nhận mở lại", retryReopen: "Thử lại yêu cầu mở lại", reopening: "Đang mở lại...", checkingReopen: "Đang kiểm tra mở lại...", confirmPrompt: "Mở lại Quest đã hoàn thành và hoàn tác EXP?", reopened: "Đã xác nhận mở lại. Tải lại trang để đọc trạng thái Quest hiện tại.", earlier: "Yêu cầu hoàn thành trước đã được xác nhận. Kiểm tra công cụ khôi phục Quest để tải lại hoặc dọn dẹp.", disposition: "Không cần thử hoàn thành lại yêu cầu này. Xem thông tin trong công cụ khôi phục Quest và tải lại trang.", confirming: "Đang xác nhận hoàn thành...", checking: "Đang kiểm tra hoàn thành...", resolution: "Kiểm tra kết quả hoàn thành",
  },
  recurringControl: { recurring: "Định kỳ", definitions: "Các Quest định kỳ", pause: "Tạm dừng", resume: "Tiếp tục", confirming: "Đang xác nhận…", awaiting: "Đang chờ xác nhận", retry: "Thử lại yêu cầu tạm dừng/tiếp tục", check: "Kiểm tra khôi phục định kỳ", from: "Từ", through: "đến", monthDay: "ngày", hint: "Tạm dừng ngăn tạo lượt mới. Các lượt đã có và lịch sử EXP được giữ nguyên." },
  questManage: {
    actions: "Thao tác Quest", archive: "Lưu trữ", restore: "Khôi phục", delete: "Xóa vĩnh viễn", cancel: "Hủy",
    confirmArchive: "Xác nhận lưu trữ", confirmRestore: "Xác nhận khôi phục", confirmDelete: "Xóa vĩnh viễn", working: "Đang xử lý…",
    archivePrompt: "Lưu trữ Quest này? Quest sẽ rời danh sách đang hoạt động, giữ nguyên lịch sử và EXP, và có thể khôi phục sau.",
    restorePrompt: "Khôi phục Quest này về các màn hình đang hoạt động?",
    deletePrompt: "Xóa vĩnh viễn Quest này khỏi SYSTEM? Quest sẽ không thể khôi phục. Nếu Quest hiện đang hoàn thành, hãy Mở lại trước để hoàn tác EXP. Lịch sử audit bất biến của hệ thống vẫn được giữ lại.",
    reopenFirst: "Hãy Mở lại Quest đã hoàn thành trước khi xóa vĩnh viễn.",
    restoreReopenFirst: "Hãy Khôi phục Quest, rồi Mở lại trước khi xóa vĩnh viễn.",
    recoveryTitle: "Khôi phục thao tác Quest", retryExact: "Thử lại đúng yêu cầu đã lưu", checkRecovery: "Kiểm tra khôi phục lại",
    recoveryBlocked: "Dữ liệu khôi phục Quest hoặc phối hợp giữa các tab không khả dụng hay đã thay đổi. Hãy giữ yêu cầu đã lưu và kiểm tra khôi phục trước khi tiếp tục.",
    archivedSuccess: "Đã lưu trữ Quest.", restoredSuccess: "Đã khôi phục Quest.", deletedSuccess: "Đã xóa vĩnh viễn Quest.",
    account: "Tài khoản đăng nhập đã thay đổi. Hãy tải lại trước khi tiếp tục.",
    validation: "Yêu cầu thao tác Quest không hợp lệ. Hãy tải lại rồi thử lại.",
    completed: "Hãy Mở lại Quest đã hoàn thành trước khi xóa vĩnh viễn.",
    goal: "Hãy gỡ Quest khỏi Main Quest trước khi xóa vĩnh viễn.",
    recurring: "Thao tác này chỉ dành cho Quest một lần. Hãy dùng điều khiển Quest định kỳ cho Quest lặp lại.",
    deleted: "Quest này đã được xóa vĩnh viễn.",
    exp: "EXP của Quest chưa được hoàn tác đầy đủ. Hãy Mở lại Quest đã hoàn thành và tải lại trước khi xóa.",
    conflict: "Yêu cầu này xung đột với lịch sử Quest đã ghi. Hãy tải lại trước khi gửi thao tác khác.",
    stale: "Quest đã thay đổi hoặc không còn khả dụng. Hãy tải lại trước khi tiếp tục.",
    unknown: "Đang chờ xác nhận. Yêu cầu chính xác đã được lưu; hãy thử lại trước khi bắt đầu thao tác Quest khác.",
    archivedTitle: "Quest đã lưu trữ", archivedHeading: "QUEST ĐÃ LƯU TRỮ",
    archivedHint: "Quest một lần đã lưu trữ không xuất hiện ở màn hình hoạt động nhưng vẫn giữ lịch sử và EXP.",
    archivedEmpty: "Chưa có Quest một lần nào được lưu trữ.", archivedAt: "Đã lưu trữ",
    loadingArchived: "Đang tải Quest đã lưu trữ...", unavailable: "Không thể tải Quest đã lưu trữ an toàn.",
    session: "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để quản lý Quest đã lưu trữ.",
  },
  navigation: { label: "Điều hướng SYSTEM", dashboard: "Tổng quan", calendar: "Lịch", goals: "Mục tiêu / Main Quest" },
  shell: { dashboard: "Hành động có chủ đích. Tiến bộ mỗi ngày.", calendar: "Thời gian của bạn, cùng các Quest.", goals: "Kết nối các Quest với một mục tiêu chung." },
  locale: { label: "Ngôn ngữ", apply: "Áp dụng ngôn ngữ", hint: "Áp dụng cho điều hướng, tiêu đề trang và tổng quan Dashboard.", unavailable: "Không lưu được ngôn ngữ. Hãy cho phép cookie rồi thử lại." },
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
