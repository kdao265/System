import "server-only";
import { unstable_rethrow } from "next/navigation";
import { getProfileContext, isOnboardingComplete } from "@/features/profile/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isBookId, parseBookDetail, parseBookPage, type Book, type BookPage } from "./model";
import { invalid, validateList, type LibraryFailure, type LibraryRead } from "./contracts";

// The existing helper verifies auth.getUser and configured ownership. Its login
// redirect is intentional control flow, including for direct Server Action calls.
export async function libraryContext(): Promise<{ outcome: "success"; userId: string } | LibraryFailure> {
  try {
    const { user, profile, error } = await getProfileContext();
    if (error === "unavailable") return { outcome: "infrastructure_failure" };
    if (!isOnboardingComplete(profile)) return { outcome: "onboarding_required" };
    return { outcome: "success", userId: user.id.toLowerCase() };
  } catch (error) {
    unstable_rethrow(error);
    return { outcome: "infrastructure_failure" };
  }
}

export function readFailure(error: { code?: string }): LibraryFailure {
  if (error.code === "P0002") return { outcome: "not_found" };
  if (error.code === "42501" || error.code === "PGRST301" || error.code === "PGRST303") return { outcome: "unauthorized" };
  return { outcome: "infrastructure_failure" };
}

export async function getBooks(input: unknown = {}): Promise<LibraryRead<BookPage>> {
  const context = await libraryContext();
  if (context.outcome !== "success") return context;
  const parsed = validateList(input);
  if (!parsed.ok) return invalid(parsed.field, parsed.code);
  const { scope, status, cursor, limit } = parsed.value;
  try {
    const client = await createServerSupabaseClient(true);
    const { data, error } = await client.rpc("list_books_v1", {
      p_scope: scope, p_status: status, p_after_created_at: cursor?.created_at ?? null,
      p_after_id: cursor?.id.toLowerCase() ?? null, p_limit: limit,
    });
    if (error) return readFailure(error);
    const page = parseBookPage(data);
    if (!page || page.books.length > limit || page.books.some(b =>
      (b.archived_at !== null) !== (scope === "archived") || (status !== null && b.status !== status))) {
      return { outcome: "infrastructure_failure" };
    }
    return { outcome: "success", value: page };
  } catch (error) {
    unstable_rethrow(error);
    return { outcome: "infrastructure_failure" };
  }
}

export async function getBook(id: unknown): Promise<LibraryRead<Book>> {
  const context = await libraryContext();
  if (context.outcome !== "success") return context;
  if (!isBookId(id)) return invalid("bookId");
  try {
    const client = await createServerSupabaseClient(true);
    const { data, error } = await client.rpc("get_book_v1", { p_book_id: id.toLowerCase() });
    if (error) return readFailure(error);
    const book = parseBookDetail(data);
    if (!book) return { outcome: "infrastructure_failure" };
    // Defense in depth; RLS and RPC ownership remain authoritative.
    if (book.id.toLowerCase() !== id.toLowerCase() || book.user_id.toLowerCase() !== context.userId) return { outcome: "not_found" };
    return { outcome: "success", value: book };
  } catch (error) {
    unstable_rethrow(error);
    return { outcome: "infrastructure_failure" };
  }
}
