// Synthetic-only fixtures shared by the pure Node test suite; no external URLs are fetched.
export const owner = "11111111-1111-4111-8111-111111111111";
export const command = "22222222-2222-4222-8222-222222222222";
export const linkId = "550e8400-e29b-41d4-a716-446655440001";
export const link2Id = "550e8400-e29b-41d4-a716-446655440002";
export const validUrls = ["https://example.invalid/path?q=Việt😀#section", "HTTPS://Example.Invalid:443/path", "https://127.0.0.1:65535/a", "https://[::1]/a", "https://example.invalid./ok"];
export const invalidUrls = ["http://example.invalid", "//example.invalid", "https://user@example.invalid", "https://:pw@example.invalid/", "https://example.invalid:65536/", "https://example.invalid:000000/a", "https://example.invalid/a b", "https://example.invalid/a\\b", "https://-bad.invalid", "https://bad..invalid", "https://127.1", "https://0177.0.0.1", "https://0x7f000001", "https://256.1.1.1", "https://[not-ip]/", "https://example.invalid/\u0000", "https://example.invalid/\ud800", "https://example.invalid/a\ufeffb"];
export const dateExamples = [
  {precision:"unknown"}, {precision:"year",year:2026},
  {precision:"month",year:2026,month:2}, {precision:"day",year:2024,month:2,day:29},
];
export const deadlineUnresolved = {precision:"day",year:2026,month:11,day:15,source_time:"23:59",source_time_state:"unresolved"};
export const nyWinterDeadline = {precision:"instant",source_date:"2026-11-15",source_time:"23:59",source_zone:"America/New_York",source_offset_minutes:-300};
export const activityCreatedTime = "2026-10-10T10:30:00.000000+00:00";
