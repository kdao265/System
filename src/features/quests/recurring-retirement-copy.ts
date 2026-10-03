import type { Locale } from "@/lib/localization/dictionaries";

const en = {
  title: "Archived Recurring Quests", empty: "No archived recurring Quests.",
  hint: "Archived series and their existing occurrences are frozen until restored. Pause state and earned EXP are preserved.",
  archive: "Archive", restore: "Restore", delete: "Delete permanently", cancel: "Cancel",
  confirmArchive: "Confirm archive", confirmRestore: "Confirm restore", confirmDelete: "Confirm permanent delete",
  archivePrompt: "Archive this recurring Quest? Future generation stops and existing occurrences become hidden and non-actionable until restore. Their status, Pause state and earned EXP stay unchanged.",
  restorePrompt: "Restore this recurring Quest with its existing occurrences and prior Pause state? Running series may generate today/future slots again; missed past slots are not backfilled.",
  deletePrompt: "This series cannot be restored. Future generation stops permanently and all existing occurrences are permanently frozen. Previously earned EXP and immutable history remain. If any occurrence needs Reopen or correction, restore the series and correct it BEFORE permanent deletion.",
  unavailable: "Recurring Quest data is unavailable. Refresh and try again.",
  rejected: "The recurring Quest action was rejected. Refresh its current state; permanent deletion requires archive first.",
  unknown: "The outcome is unknown. Use Recurring Quest recovery to retry the exact saved request.",
  success: "Request confirmed. Refreshing current recurring Quest state…", archivedAt: "Archived",
};
const vi: typeof en = {
  title: "Nhiệm vụ lặp lại đã lưu trữ", empty: "Chưa có nhiệm vụ lặp lại đã lưu trữ.",
  hint: "Chuỗi và các lần thực hiện được đóng băng đến khi khôi phục. Trạng thái tạm dừng và EXP đã nhận được giữ nguyên.",
  archive: "Lưu trữ", restore: "Khôi phục", delete: "Xóa vĩnh viễn", cancel: "Hủy",
  confirmArchive: "Xác nhận lưu trữ", confirmRestore: "Xác nhận khôi phục", confirmDelete: "Xác nhận xóa vĩnh viễn",
  archivePrompt: "Lưu trữ nhiệm vụ lặp lại? Ngừng tạo lần thực hiện mới; các lần hiện có bị ẩn và không thể thao tác đến khi khôi phục. Trạng thái, tạm dừng và EXP giữ nguyên.",
  restorePrompt: "Khôi phục chuỗi cùng các lần thực hiện và trạng thái tạm dừng trước đó? Chuỗi đang chạy có thể tạo lần hôm nay hoặc tương lai; không tạo bù ngày đã qua.",
  deletePrompt: "Không thể khôi phục chuỗi này. Việc tạo lần mới dừng vĩnh viễn và mọi lần hiện có bị đóng băng vĩnh viễn. EXP đã nhận và lịch sử bất biến vẫn được giữ. Nếu cần Mở lại hoặc sửa một lần thực hiện, hãy khôi phục chuỗi và sửa TRƯỚC KHI xóa vĩnh viễn.",
  unavailable: "Không tải được nhiệm vụ lặp lại. Hãy tải lại trang.",
  rejected: "Thao tác bị từ chối. Hãy tải lại trạng thái hiện tại; phải lưu trữ trước khi xóa vĩnh viễn.",
  unknown: "Chưa rõ kết quả. Dùng phần khôi phục thao tác để thử lại đúng yêu cầu đã lưu.",
  success: "Đã xác nhận. Đang tải lại trạng thái nhiệm vụ lặp lại…", archivedAt: "Đã lưu trữ",
};
export const recurringRetirementCopy = (locale: Locale) => locale === "vi" ? vi : en;
