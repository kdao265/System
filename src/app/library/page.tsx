import { SystemShell } from "@/components/system-shell";
import Link from "next/link";
import { EmptyState, Panel, SectionHeader } from "@/components/ui/primitives";
import { getBooks } from "@/features/library/data";
import { BookCard } from "@/features/library/book-card";
import { BOOK_STATUSES } from "@/features/library/model";
import { LibraryFeedback } from "@/features/library/feedback";
import { libraryPageContext } from "@/features/library/page-context";
import { libraryHref, libraryQuery } from "@/features/library/navigation";

export const dynamic = "force-dynamic";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { context, locale, copy: t } = await libraryPageContext();
  const query = libraryQuery(await searchParams);
  const result = context.outcome === "success" ? await getBooks(query) : context;
  return <SystemShell current="library" lang={locale} width="wide" pageClassName="library-page">
    <SectionHeader title={t.heading} description={t.description}><Link prefetch={false} className="ui-button ui-button-primary" href="/library/new">{t.add}</Link></SectionHeader>
    <div className="library-toolbar">
      <nav className="library-actions" aria-label={t.scope}>{(["active", "archived"] as const).map(scope =>
        <a key={scope} href={libraryHref({ ...query, scope })} className="ui-button ui-nav-link" aria-current={query.scope === scope ? "page" : undefined}>{t[scope]}</a>)}</nav>
      <nav className="library-actions" aria-label={t.filters}>{([null, ...BOOK_STATUSES]).map(status =>
        <a key={status ?? "all"} href={libraryHref({ ...query, status })} className="ui-button ui-nav-link" aria-current={query.status === status ? "page" : undefined}>{status ? t.statuses[status] : t.all}</a>)}</nav>
    </div>
    {result.outcome !== "success" ? <div className="library-feedback"><LibraryFeedback failure={result} copy={t} /><a className="ui-button" href={libraryHref(query, query.cursor)}>{t.retry}</a></div>
      : result.value.books.length ? <ul className="library-grid" aria-label={t.collection}>{result.value.books.map(book => <li key={book.id}><BookCard book={book} copy={t} /></li>)}</ul>
        : <Panel><EmptyState title={query.status || query.cursor ? t.filteredEmpty : query.scope === "archived" ? t.archivedEmpty : t.empty} description={query.status || query.scope === "archived" ? undefined : t.emptyHint}>
          {query.status && <a className="ui-button" href={libraryHref({ ...query, status: null })}>{t.resetFilters}</a>}
        </EmptyState></Panel>}
    <nav className="library-actions library-pagination" aria-label={t.pagination}>
      {query.cursor && <a className="ui-button" href={libraryHref(query)}>{t.first}</a>}
      {result.outcome === "success" && result.value.next_cursor && <a className="ui-button" href={libraryHref(query, result.value.next_cursor)}>{t.next}</a>}
    </nav>
  </SystemShell>;
}
