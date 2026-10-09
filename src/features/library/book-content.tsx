import { Badge } from "@/components/ui/primitives";
import type { Dictionary } from "@/lib/localization/dictionaries";
import type { Book } from "./model";
import { BookCover } from "./book-cover";

export function BookContent({ book, copy }: { book: Book; copy: Dictionary["library"] }) {
  return <div className="library-book-content">
    <div className="library-book-heading">
      <BookCover key={book.cover_url} url={book.cover_url} copy={copy} />
      <div><h2 className="library-book-title">{book.title}</h2>
        {book.author && <p className="library-author">{book.author}</p>}
        <div className="library-badges"><Badge tone="accent">{copy.statuses[book.status]}</Badge>{book.archived_at && <Badge>{copy.archived}</Badge>}</div>
      </div>
    </div>
    <div className="library-notes">
      {(["summary", "content_notes", "lessons"] as const).map(field => <section key={field}>
        <h3 className="type-section">{copy.fields[field]}</h3>
        <p className={`library-note${book[field] ? "" : " text-muted"}`}>{book[field] ?? copy.noText}</p>
      </section>)}
    </div>
  </div>;
}
