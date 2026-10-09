# SYSTEM V1 — Activities & Opportunities: Requirements

**Trạng thái:** APPROVED L0 CONTRACT — Product Owner đã phê duyệt bộ tài liệu L0 và AO-01–09, G-01–06; chưa phê duyệt triển khai.  
**Ngày phê duyệt:** 2026-10-10 · **Vị trí:** `docs/01-requirements/activities-opportunities-v1.md`.  
**Tài liệu liên quan:** [ADR-024](../02-architecture/decisions.md) · [Architecture](../02-architecture/activities-opportunities-v1.md) · [Task Contract](../04-development/activities-opportunities-v1.md).

## 1. Nguồn thẩm quyền và ranh giới

Nguồn nghiệp vụ: quyết định PO AO-01, AO-04B, AO-05, AO-06 (+ Quest Delete A; R1–R8), AO-07, AO-08, AO-09 và G-01–G-06. AO-02/AO-03 không được cấp nội dung phê duyệt đầy đủ trong gói lịch sử; **không tự suy ra** chúng. Các quyết định G là các lựa chọn kiến trúc đã được PO duyệt về hướng thiết kế, **không đồng nghĩa đã duyệt migration, từng SQL statement hay ứng dụng đã hoàn thành**.

Đối chiếu repo bằng GitHub read-only tại `main@d380133804704552e2ed8969570210663c486dce` (kiểm tra 2026-10-09). Các đường dẫn tham chiếu: [ADR decisions](https://github.com/kdao265/System/blob/main/docs/02-architecture/decisions.md), [Goals Requirements](https://github.com/kdao265/System/blob/main/docs/01-requirements/goals-main-quest-v1.md), [Goals migration](https://github.com/kdao265/System/blob/main/supabase/migrations/20260930120000_create_goals_main_quest.sql), [Quest Archive/Delete](https://github.com/kdao265/System/blob/main/supabase/migrations/20261002013000_quest_archive_delete_v1.sql), [Calendar requirements](https://github.com/kdao265/System/blob/main/docs/01-requirements/calendar-schedule.md), [AI agent workflow](https://github.com/kdao265/System/blob/main/docs/04-development/ai-agent-workflow.md). Reconfirm latest `main` trước mọi công việc trong repo.

**Domain vocabulary:**

- **Opportunity:** cơ hội được lưu/tìm hiểu/chuẩn bị/nộp hoặc đăng ký/đóng; chưa có nghĩa đã tham gia.
- **Activity:** kế hoạch tham gia **đã xác nhận**, hoặc hoạt động **đã thực sự tham gia**; có lifecycle riêng.
- **Source Opportunity:** nguồn gốc tùy chọn của Activity (Opportunity 1:N Activities; Activity 0..1 source hiện hành), thay/gỡ được và giữ lịch sử; **không** là Contextual Link.
- **Contextual Link:** bốn liên kết N:N giữa Opportunity hoặc Activity với Goal hoặc **one-off Quest**. Chỉ mang ngữ cảnh, không thay `goal_quest_links`.
- **Quest:** domain thực thi nhiệm vụ, Complete/Reopen/EXP độc quyền của Quest Engine. **Goal Progress** chỉ suy ra từ membership `goal_quest_links` và Quest occurrences (ADR-020).
- **Criterion/Evidence:** đánh giá yêu cầu và minh chứng là domain riêng; văn bản `outcomes`, `contributions` và Resource Link không được mặc nhiên xác minh.
- **Archived:** trạng thái lưu trữ của root, độc lập với Opportunity Stage/Outcome và Activity Status; không hard delete AO V1.

## 2. Ma trận quyết định đã phê duyệt

| Quyết định | Quy định chuẩn |
| --- | --- |
| AO-01 | Hai aggregate roots độc lập; nguồn phát sinh có thể liên kết nhưng không đồng bộ tự động. |
| AO-04B | Upcoming chỉ cho kế hoạch tham gia đã xác nhận; lịch sử completed/ended_early nhập trực tiếp; terminal correction có audit. |
| AO-05.1–05.5 | Accepted không auto-create Activity; 1:N nguồn; mỗi Activity tối đa một nguồn hiện hành; không sync trạng thái; sửa/gỡ/chuyển nguồn có immutable history. |
| AO-06 | Opportunity↔Goal, Activity↔Goal, Opportunity↔one-off Quest, Activity↔one-off Quest đều N:N; không bắc cầu, không Progress/EXP/Status propagation, retain attach/detach. |
| AO-06 Quest Delete A | Contextual Link không chặn Quest Delete; giữ tham chiếu và chỉ placeholder khi Quest Deleted. |
| AO-06 R1–R8 (chốt AO-09) | Cùng owner; tối đa một link hiện hành/cặp; detach/reattach mới; không gắn mới vào archived/deleted target; source archived chỉ đọc; terminal Activity chưa archived được quản lý link; replay/concurrency an toàn. |
| AO-07.1–07.6 | Partial Date/instant có precision, calendar/DST/timezone validation, không đoán timezone, warning deadline là derived, temporal history bất biến. |
| AO-08 | Tạo nhanh, category tùy chọn; Archive-only; detail Relationships/History; EN/VI responsive, safe recovery. |
| AO-09 | Opportunity 4 tracking stages + 6 outcomes; Activity 6 statuses; field/limit, URL collection, validation và ranh giới không tự sửa Quest/Goal/Calendar. |
| G-01 | Strict Partial Date/DeadlineSpec JSONB, server-verified UTC instant column, source timezone/offset, DST gap/fold rejection/clarification. |
| G-02 | Strict Resource Links JSONB ≤30/root; label ≤120, HTTPS URL ≤2048; 7 Closed Reasons; closed_note/confirmation_note ≤2000; history/recovery. |
| G-03 | 10 tables; AO command namespace riêng; root revision; typed RPC; immutable accepted receipts, exact replay, atomic history/recovery. |
| G-04 | Mọi AO mutation dùng `progression_internal.lock_owner(actor)` trước row locks; composite owner FK, restrictive RLS, minimal executor; deleted Quest safe projection; không đổi Quest Delete; chặn fresh source attach vào archived Opportunity. |
| G-05 | Bổ sung `entry_mode`, `selection_applicability`; giữ 4 stages/6 outcomes; tách cảnh báo khỏi hard reject; non-application opportunities hợp lệ. |
| G-06 | Group Growth chứa Activities/Opportunities, 6 routes, existing Shell/Auth/EN-VI; browser recovery metadata tối thiểu, không auto retry sau reload khi thiếu payload; disposable migration harness/checkpoint sau Library. |

## 3. User stories

| ID | Nhu cầu |
| --- | --- |
| US-AO-01 | Lưu một học bổng, chương trình, hội thảo hoặc lời mời chỉ bằng title; bổ sung dữ liệu sau. |
| US-AO-02 | Theo dõi quá trình chuẩn bị/nộp mà không đánh đồng Selection Outcome và participation. |
| US-AO-03 | Lưu deadline nước ngoài, ngày không đầy đủ, giờ nguồn thiếu timezone mà không giả tạo instant. |
| US-AO-04 | Chỉ sau xác nhận tham gia mới tạo Upcoming, kể cả cơ hội không xét tuyển. |
| US-AO-05 | Quản lý vòng đời Activity; nhập quá khứ không phát sinh transition/EXP giả. |
| US-AO-06 | Lưu Source Opportunity, Goal/Quest links và lịch sử liên kết, gồm tham chiếu Quest đã xóa. |
| US-AO-07 | Sửa dữ liệu thời gian/correct status/đóng rồi mở lại có audit. |
| US-AO-08 | Archive/Restore bảo toàn nội dung và liên kết; xem được kết quả lịch sử. |
| US-AO-09 | Sửa an toàn qua hai tab, mất phản hồi và reload; không double-submit hoặc tự ghi đè. |
| US-AO-10 | Sử dụng trên desktop/mobile với EN/VI, tìm kiếm/lọc/phân trang và a11y. |

## 4. Functional requirements (traceable)

| ID | Normative requirement | Decision |
| --- | --- | --- |
| AO-FR-01 | Create/list/get/edit Opportunity. Title bắt buộc; `tracking_stage=saved`, `selection_outcome=unknown`, `entry_mode=unknown`, `selection_applicability=unknown` mặc định. | AO-08/09 G-05 |
| AO-FR-02 | Activity create/list/get/edit yêu cầu title **và explicit participation intent**; không mặc định Upcoming chỉ vì có title. | AO-04/08/09 |
| AO-FR-03 | Stage/Outcome độc lập; không auto đổi vì deadline, selection hoặc Activity; historical import không bịa bước. | AO-05/09 G-05 |
| AO-FR-04 | Close/Reopen Tracking là command rõ ràng có history; Closed chưa archived có thể bổ sung thông tin hoặc Outcome đến muộn. | AO-09 G-05 |
| AO-FR-05 | Cho phép Entry Mode: `unknown/application/registration/invitation/direct_access/other`; Selection Applicability: `unknown/applicable/not_applicable`. | G-05 |
| AO-FR-06 | `selection_applicability=not_applicable` bắt buộc `selection_outcome=unknown`; `unknown` != `not_applicable` trong UI. | G-05 |
| AO-FR-07 | Activity hỗ trợ sáu trạng thái và transition hợp lệ; `correct_activity_status` riêng có audit và cập nhật ngày liên quan atomically. | AO-04/09 |
| AO-FR-08 | Historical Activity direct Completed/Ended Early, không tạo giả các Start/Complete event và không cấp EXP. | AO-04/09 |
| AO-FR-09 | Partial Dates unknown/year/month/day, DeadlineSpec có thể thêm instant; giữ source precision và không ép date-only thành UTC midnight. | AO-07 G-01 |
| AO-FR-10 | Server xác minh timezone + offset, UTC instant và DST; khi thiếu timezone thì giữ giờ nguồn ở trạng thái unresolved không tạo exact instant. | AO-07 G-01 |
| AO-FR-11 | Planned Start/End khác Actual Start/End. Thay đổi có trước/sau/history, không tạo auto status transition. | AO-07 |
| AO-FR-12 | Deadline past/approaching chỉ là gợi ý suy ra, không khẳng định cổng đơn đã đóng và không tự đổi Stage/Outcome. | AO-07 |
| AO-FR-13 | Source Opportunity 0..1 per Activity và 0..N Activities per Opportunity; thay/gỡ/reattach bằng interval mới với lịch sử. | AO-05 G-03 |
| AO-FR-14 | Bốn contextual N:N link types, same-owner; một current link/cặp; history attach/detach; exact link ID on detach. | AO-06 G-03/04 |
| AO-FR-15 | Fresh attach chỉ cho Goal/one-off Quest đủ điều kiện và chưa archived/deleted; Source Opportunity mới phải chưa archived; archived AO nguồn không có mutation ngoài Restore/replay. | AO-06 G-04 |
| AO-FR-16 | Quest Delete không bị context link chặn; deleted Quest chỉ hiện placeholder (không title/description/status/reward), không leak qua history/receipt/API. | AO-06 A G-04 |
| AO-FR-17 | Archive/Restore độc lập; archived root vẫn xem được, fresh changes bao gồm no-op bị chặn trừ set_archived desired state. Không có hard-delete API/UI/grant. | AO-08/09 |
| AO-FR-18 | Resource Links JSONB structured, 0..30 items, mỗi link UUID, label ≤120, HTTPS URL ≤2048, không fetch/proxy/execute. | G-02 |
| AO-FR-19 | Plain text fields Unicode; giới hạn và normalization nhất quán app/SQL; không cắt ngầm; duplicate titles hợp lệ. | AO-09 G-02 |
| AO-FR-20 | Dùng 6 protected routes, Growth navigation, EN/VI, responsive, a11y; list filters và bounded pagination, history + relationships. | AO-08 G-06 |
| AO-FR-21 | Mọi mutation atomic với root revision, một namespace AO command, exact replay before fresh revision checks, immutable history/receipts, no-op receipt. | G-03/04 |
| AO-FR-22 | Mất phản hồi: confirmed/rejected/unknown; giữ bản nháp đang mở; sau reload chỉ resolve read-only, không tự retry khi payload không còn. | G-03/06 |
| AO-FR-23 | Auth Profile onboarding, configured owner, restrictive RLS, composite FK, least-privilege executor; không privilege escalation qua links. | G-04/06 |
| AO-FR-24 | AO không tạo Quest, Quest Event, EXP, `goal_quest_links`, Calendar Event, Evidence Verification, Criterion Satisfaction hoặc Portfolio. | AO-01/06/09 |

## 5. Opportunity lifecycle và consistency

### 5.1 Tracking Stage — đúng bốn giá trị

` saved → preparing → submitted → closed ` là *hành trình điển hình*, không phải yêu cầu phải đi qua tất cả bước. Cho phép Saved→Submitted, Saved/Preparing/Submitted→Closed; Closed→Saved/Preparing/Submitted chỉ qua `Reopen Tracking`. Nhập trực tiếp stage hồi cứu là hợp lệ khi Create; không sinh fake transitions. `submitted` chỉ dùng khi đã thực sự nộp/đăng ký/phản hồi thủ tục tương đương, không phải khi nhận lời mời hoặc chỉ tìm hiểu. Closed không phải Rejected và chưa Archived vẫn cập nhật nội dung/Outcome; chỉnh stage nhập sai có history loại `correction`.

### 5.2 Selection Outcome — đúng sáu giá trị

`unknown`, `pending`, `shortlisted`, `waitlisted`, `accepted`, `rejected`. Outcome không tự chuyển theo Stage hoặc tự tạo Activity. Cho phép Record Outcome theo thực tế, gồm kết quả mới đến sau Closed, và correction có lịch sử riêng. Kết quả trung gian không bắt buộc đi qua thứ tự; một cơ hội được mời hoặc không cần thủ tục vẫn hợp lệ.

### 5.3 Entry Mode, Applicability và Closed Reason

- Entry Mode enum: `unknown`, `application`, `registration`, `invitation`, `direct_access`, `other` (default `unknown`).
- Selection Applicability: `unknown`, `applicable`, `not_applicable` (default `unknown`). `not_applicable` chỉ hợp lệ với Outcome `unknown`; UI hiển thị **Không áp dụng**, không hiển thị **Chưa rõ kết quả**.
- Closed Reason enum: `not_interested`, `withdrawn`, `declined_offer`, `deadline_missed`, `program_cancelled`, `process_finished`, `other` (nullable khi Closed).
- Stage != Closed ⇒ current `closed_reason` và `closed_note` là null. Closed Reason `other` ⇒ `closed_note` không blank. Khi Reopen Tracking, current reason/note trở null, nhưng lịch sử Close cũ giữ nguyên. Có thể sửa Closed Reason (audit).
- Closed `declined_offer` + Outcome Unknown ⇒ **warning**, không hard reject. Closed `accepted` hoặc `rejected` đều hợp lệ.

### 5.4 Hard rejects vs contextual warnings

**Hard reject:** invalid enums; `not_applicable` + Outcome khác unknown; Closed fields khi Stage không Closed; `closed_reason=other` thiếu note; invalid date/time/URL/text; stale revision, wrong owner, archived fresh edit, conflicting command reuse.

**Warning, cho phép sau xác nhận trong UI:** `saved+accepted`; `submitted` thiếu `applied_at`; `invitation+submitted` khi chưa rõ thủ tục; `direct_access+submitted`; `declined_offer+unknown`; deadline quá khứ+preparing. Warnings **không** được bí mật biến thành SQL CHECK chỉ vì tổ hợp ít gặp. Không cần hỏi lại khi chỉ đọc hoặc không sửa các trường liên quan.

## 6. Activity lifecycle

| Current | Explicit command | New | Constraint |
| --- | --- | --- | --- |
| Create | Confirm plan | `upcoming` | Chỉ khi xác nhận kế hoạch đã chốt; actual start/end chưa có |
| Create | Confirm started | `ongoing` | Đã tham gia thực tế; actual start có thể unknown |
| Historical import | Completed / Ended Early | `completed` / `ended_early` | Không tạo intermediate transitions |
| upcoming | Start | ongoing | Xác nhận bắt đầu, không auto theo calendar |
| upcoming | Cancel Before Start | cancelled_before_start | Không có actual start/end |
| ongoing | Pause | paused | Không set actual end |
| paused | Resume | ongoing | Không overwrite actual start |
| ongoing,paused | Complete | completed | Xác nhận hoàn thành; actual end có thể unknown |
| ongoing,paused | End Early | ended_early | Xác nhận kết thúc sớm; actual end có thể unknown |
| terminal | Correct Status | Valid target | Lệnh ngoại lệ có before/after + reason tùy chọn, update thời gian liên quan nguyên tử |

Terminal: `completed`, `ended_early`, `cancelled_before_start`; không trở lại bằng transition thường. Việc có `actual_start=unknown` không có nghĩa chưa bắt đầu khi trạng thái đang ongoing/paused/completed. Không dùng `created_at`/`status_changed_at` để tự điền actual date. Terminal mà chưa archived vẫn được sửa mô tả, kết quả, bài học và links.

## 7. Field contract và giới hạn (Unicode code points)

### Opportunity fields

| Field | Loại / quy tắc |
| --- | --- |
| `title` | text required, nonblank, ≤240 |
| `category` | nullable: scholarship/internship/fellowship/competition/research/training/program/event/other |
| `organization` | nullable text ≤240 |
| `description` | nullable text ≤4,000 |
| `eligibility_notes`, `benefits_notes` | nullable text ≤10,000 mỗi trường |
| `tracking_stage` | enum 4 trạng thái, default saved |
| `selection_outcome` | enum 6 kết quả, default unknown |
| `entry_mode` | enum 6 hình thức, default unknown |
| `selection_applicability` | enum 3 giá trị, default unknown |
| `closed_reason` | nullable enum 7; chỉ có nếu stage Closed |
| `closed_note` | nullable text ≤2,000; bắt buộc nonblank với reason other |
| `application_deadline` | strict DeadlineSpec, có thể unresolved source clock; xem §8 |
| `program_start`, `program_end`, `applied_at`, `decision_at` | PartialDate, optional |
| `priority` | nullable low/medium/high; không tác động Quest priority/EXP |
| `notes` | nullable text ≤10,000 |
| `resource_links` | JSONB collection có quy tắc §7.3 |
| source-derived Activities / Related Goal/Quest | projections từ relationship tables; **không** embedded IDs array authoritative |

### Activity fields

| Field | Loại / quy tắc |
| --- | --- |
| `title` | text required nonblank ≤240 |
| `category` | nullable research/project/club/volunteer/training/competition/internship/event/other |
| `organization` | nullable text ≤240 |
| `role` | nullable text ≤160 |
| `description` | nullable text ≤4,000 |
| `status` | enum 6 statuses; explicit create/intent |
| `planned_start`, `planned_end`, `actual_start`, `actual_end` | PartialDate, optional, lifecycle validated |
| `participation_confirmed_at` | database-owned timestamp of owner confirmation for Upcoming, not proof of original real-world date |
| `confirmation_note` | nullable text ≤2,000 |
| `contributions`, `outcomes`, `lessons`, `notes` | nullable text ≤10,000 mỗi trường |
| `resource_links` | JSONB collection theo §7.3 |
| `source_opportunity_id` | nullable read projection from current source interval, **not** duplicate authoritative column |
| Related Goal/Quest | read projection of active context links |

**System-owned:** immutable UUID `id`, `user_id`, `created_at`; database-controlled `updated_at`, `archived_at`, positive `bigint revision`; event/receipt timestamps. No direct client override. Không unique tên/title+organization. Nullable text blank-only→null; long text CRLF/CR→LF và giữ spacing có ý nghĩa, không silent truncate, cùng normalization ở TypeScript/SQL. Reject NUL/invalid text encoding.

### 7.3 Resource Links

JSONB structured array, tối đa **30** entries/root. Mỗi entry có **UUID ổn định, duy nhất trong array**, `label` nonblank ≤120, absolute **HTTPS** URL ≤2,048 Unicode code points, không `userinfo`, control characters, unsupported scheme. Thứ tự array là thứ tự hiển thị; URL trùng được phép (UI có thể warning). Không DNS lookup, URL fetch, proxy, tự rewrite/strip query, render HTML hoặc convert sang Evidence. Entire update atomic với revision guard của root. Resource Link không có own lifecycle/revision/table.

## 8. Temporal fidelity contract

- `PartialDate`: discriminated `{precision:unknown|year|month|day}`. Unknown không phải current date/epoch. Year/month/day là civil calendar, không UTC midnight. Missing property trong update = không sửa; explicit Unknown = clear.
- `DeadlineSpec`: PartialDate hoặc exact instant (source local date/time, timezone IANA hoặc UTC offset, offset đã resolved); nếu có published clock nhưng chưa có timezone thì lưu clock nguồn **unresolved** và ngày source, `deadline_at_utc=NULL`, không gọi đó là instant.
- Strict JSONB keys/types/calendar validation ở SQL lẫn TypeScript; server kiểm chứng UTC, DST gaps/folds, zone-offset consistency. Tại DST fold phải làm rõ offset; gap thì reject.
- Với khoảng partial date, chỉ reject khi start chắc chắn sau end; overlap do thiếu độ chính xác được phép. Một Activity kéo dài một ngày hợp lệ.
- `deadline_at_utc` (timestamptz) có giá trị duy nhất khi instant hoàn toàn xác định, cùng atomic write, giữ source timezone/offset; đổi Profile timezone không đổi giá trị nguồn/instant. Khi view, phân biệt source và local time.
- Date-only không được tự xác nhận portal đã đóng; month/year không có precise countdown. Deadline qua là derived hint, không tự sửa Stage/Outcome/Activity/Calendar.
- Temporal History trước/sau, database time, actor, command; retry không thêm history. Actual corrections khác Planned reschedule.

## 9. Relationships, archive và privacy

- AO source membership dạng interval `attached_at`/`detached_at`, tối đa 1 current source per Activity, reattach tạo identity mới; không sync metadata/status Opportunity→Activity. Fresh set-source tới Opportunity Archived bị từ chối; existing source vẫn giữ khi Opportunity bị archive.
- Bốn typed N:N Contextual Links với same-owner composite FKs, one current per pair, retained history; không bắc cầu qua Source Opportunity. Archived Goal/Quest không cho attach mới; recurring/deleted Quest không đủ điều kiện; Completed Activity vẫn cho link edits nếu chưa archived.
- Quest Delete chịu các điều kiện Quest Engine hiện hữu, **không** thêm guard vì AO links. Deleted Quest chỉ trả neutral placeholder, không copy title/description/status/reward vào AO history, link, receipts hay responses. Historical Quest IDs chỉ xử lý qua owner-safe identifiers.
- AO Archived: read-only content/links/history; Restore không tự chuyển Activity status hoặc Opportunity stage. Có thể đọc current status Goal/Quest (trừ deleted content) theo quyền owner. Không hard delete AO V1.

## 10. Routes, UX và recovery

Routes: `/opportunities`, `/opportunities/new`, `/opportunities/[id]`, `/activities`, `/activities/new`, `/activities/[id]`; Growth navigation chứa hai nhóm, không cần trang `/growth` riêng. List default active, archived scope riêng, tìm theo title/organization, filter category/Stage/Outcome/Status/known-vs-unknown deadline; order deterministic với bounded cursor (default 50/max 100 theo G-03 proposal), list projection không chứa long notes; history phân trang. Detail chia Overview, Dates, Outcome/Lifecycle, Resources, Relationships, History; chỉ mở link ra host an toàn, không fetch trên server.

Auth/Profile/onboarding và configured-owner từ SYSTEM; `SystemShell`, `AppHeader`, localization EN/VI hiện hữu; a11y/keyboard/44px/reduced-motion; kiểm thử 360/390/412/820/1024/1280. Phân biệt confirmed/rejected/unknown; giữ draft in-memory, tránh rebase không có consent. SessionStorage chỉ lưu minimal user/subject/command metadata (namespace riêng); **không lưu payload/notes/URLs hoặc tự retry command sau reload thiếu payload**. Sau reload tra receipt read-only; receipt vắng mặt không chứng minh request đã rollback. Saved commit + failed UI refresh = saved/refresh-needed.

## 11. Acceptance criteria — AO-AC-01 đến AO-AC-24

| ID | Testable acceptance |
| --- | --- |
| AO-AC-01 | Opportunity tạo bằng title duy nhất; defaults `saved/unknown/unknown/unknown`; list/detail/reload đồng nhất. |
| AO-AC-02 | Opportunity nhập trực tiếp Submitted hoặc Closed/Accepted hồi cứu không tạo fake preceding events; stage/outcome độc lập. |
| AO-AC-03 | Entry Mode registration/direct_access/invitation và Selection N/A hoạt động; N/A+non-Unknown outcome bị hard reject. |
| AO-AC-04 | Saved+Accepted và các tổ hợp hiếm được UI warning, có thể confirm lưu; không khóa bằng SQL vì chỉ bất thường. |
| AO-AC-05 | Closed reason đủ 7 giá trị; Other yêu cầu note; Reopen chỉ chọn stage đích và giữ history. |
| AO-AC-06 | Outcome mới đến sau Closed lưu mà không auto Reopen; Record Outcome khác Correction trong history. |
| AO-AC-07 | Upcoming chỉ khi explicit confirmed participation; Accepted không tự tạo Activity. Non-application source vẫn tạo Upcoming khi xác nhận. |
| AO-AC-08 | Sáu Activity statuses/transitions hợp lệ; invalid transition fail atomically; không tự đổi do ngày. |
| AO-AC-09 | Historical Completed/Ended Early direct import, không sinh fake transitions, Quest/EXP/Goal change. |
| AO-AC-10 | Correct Status (terminal) lưu history và sửa actual dates hợp lệ trong cùng transaction. |
| AO-AC-11 | Partial Date Unknown/Year/Month/Day roundtrip, leap year/reverse validation và no fabricated precision. |
| AO-AC-12 | Deadline IANA/offset/DST folds/gaps, unresolved source clock và Profile timezone conversion đúng; no guessed instant. |
| AO-AC-13 | Deadline edit giữ source/UTC before/after; expired hint không tự tạo stage/Activity/Calendar mutation. |
| AO-AC-14 | Source Opportunity replacement/gỡ/gắn lại nguyên tử; một current source; giữ audit intervals. |
| AO-AC-15 | Bốn contextual N:N cùng owner; duplicate pair bị chặn; detach/reattach tạo new link ID. |
| AO-AC-16 | Deleted Quest link vẫn giữ, không cản Quest Delete; AO API/History/UI không rò protected data. |
| AO-AC-17 | Archived Goal/Quest/Source Opportunity chặn fresh attach; links hiện hành vẫn được giữ; completed-but-unarchived Activity chỉnh được link. |
| AO-AC-18 | Archive/Restore AO giữ content/status/links, archived fresh edits kể cả no-op bị chặn; không hard-delete endpoint. |
| AO-AC-19 | Resource Links ≤30, label ≤120, HTTPS ≤2048; invalid URL bất kỳ làm rollback toàn request; không fetch/proxy. |
| AO-AC-20 | Text limits, Unicode normalization, whitespace/CRLF parity ở TS/SQL; không silent truncate. |
| AO-AC-21 | Một accepted AO command có immutable receipt; retry exact sau later edits không phát lại; command collision từ chối; no-op current revision không tăng. |
| AO-AC-22 | Revision concurrency, attach/delete/archive races, lost response/refresh failure xử lý đúng; giữ draft; read-only resolve sau reload, không replay thiếu payload. |
| AO-AC-23 | RLS+configured-owner+FK chặn cross-owner/anonymous; responsive/keyboard/EN-VI/filters/pagination/detail history. |
| AO-AC-24 | SQL/integration before-after chứng minh AO không sửa Quest Events, EXP, Goal Membership/Progress, Calendar, Library, Evidence/Criteria. Regression hiện có vẫn qua. |

Các nhóm test mức thấp G01–G06 được chi tiết trong [Architecture](../02-architecture/activities-opportunities-v1.md) §9 và [Task Contract](../04-development/activities-opportunities-v1.md) §6. Không tuyên bố các AC đã pass trước khi thực sự chạy.

## 12. Explicit non-goals và approval gates

Không: chatbot/AI, reminders/notifications, scraping, Google Calendar sync, direct Calendar Event create, Quest create/complete/reopen, EXP/rewards, recurring Quest context attach, Criteria evaluation, Evidence verification, CV/Portfolio generation, cross-owner collaboration, hard-delete AO, hay thay đổi Quest Delete prerequisite hiện hữu.

**L0 đã được PO phê duyệt; hiện chỉ ủy quyền một commit tài liệu trên branch riêng, không PR/merge hay triển khai L1–L4.** Các chữ ký SQL và mặt cắt role/RLS vẫn phải được rà soát trên latest `main` trước code.