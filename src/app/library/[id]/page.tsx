import { SystemShell } from "@/components/system-shell";
import Link from "next/link";
import { getBook } from "@/features/library/data";
import { isBookId } from "@/features/library/model";
import { BookWorkspace } from "@/features/library/book-workspace";
import { LibraryFeedback } from "@/features/library/feedback";
import { libraryPageContext } from "@/features/library/page-context";

export const dynamic = "force-dynamic";
export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { context, locale, copy: t } = await libraryPageContext();
  const { id } = await params;
  const result = context.outcome !== "success" ? context : isBookId(id) ? await getBook(id) : { outcome: "not_found" as const };
  return <SystemShell current="library" lang={locale} width="wide" pageClassName="library-page library-reading-page">
    <Link prefetch={false} className="ui-button library-back" href="/library">{t.back}</Link>
    {result.outcome === "success" ? <BookWorkspace key={`${result.value.user_id}:${result.value.id}`} book={result.value} />
      : <div className="library-feedback"><LibraryFeedback failure={result} copy={t} /><a className="ui-button" href={`/library/${encodeURIComponent(id)}`}>{t.retry}</a></div>}
  </SystemShell>;
}
