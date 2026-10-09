import { Badge } from "@/components/ui/primitives";
import type { Dictionary } from "@/lib/localization/dictionaries";
import type { BookSummary } from "./model";
import { BookCover } from "./book-cover";

export function BookCard({ book, copy }: { book: BookSummary; copy: Dictionary["library"] }) {
  return <article className="library-card">
    <BookCover key={book.cover_url} url={book.cover_url} copy={copy} />
    <div className="library-card-body">
      <h3 className="library-card-title"><a href={`/library/${book.id}`}>{book.title}</a></h3>
      {book.author && <p className="library-author">{book.author}</p>}
      <div className="library-badges"><Badge tone={book.status === "finished" ? "success" : "accent"}>{copy.statuses[book.status]}</Badge>
        {book.archived_at && <Badge>{copy.archived}</Badge>}</div>
      <a className="ui-button library-open" href={`/library/${book.id}`} aria-label={`${copy.open}: ${book.title}`}>{copy.open}<span aria-hidden="true">↗</span></a>
    </div>
  </article>;
}
