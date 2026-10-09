import { isBookCursor, isBookStatus, type BookCursor, type LibraryFilter } from "./model";

export function libraryQuery(params: Record<string, string | string[] | undefined>) {
  const filter: LibraryFilter = { scope: params.scope === "archived" ? "archived" : "active", status: isBookStatus(params.status) ? params.status : null };
  let cursor: BookCursor | null = null;
  if (typeof params.after === "string") {
    try { const value: unknown = JSON.parse(params.after); if (isBookCursor(value)) cursor = value; } catch { /* Invalid cursors start at the first page. */ }
  }
  return { ...filter, cursor };
}
export function libraryHref(filter: LibraryFilter, cursor: BookCursor | null = null) {
  const params = new URLSearchParams({ scope: filter.scope });
  if (filter.status) params.set("status", filter.status);
  // Preserve the L2 timestamp verbatim, including PostgreSQL microseconds.
  if (cursor) params.set("after", JSON.stringify(cursor));
  return `/library?${params}`;
}
