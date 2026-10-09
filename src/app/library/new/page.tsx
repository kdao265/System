import { SystemShell } from "@/components/system-shell";
import Link from "next/link";
import { LibraryCreateForm } from "@/features/library/create-form";
import { LibraryFeedback } from "@/features/library/feedback";
import { libraryPageContext } from "@/features/library/page-context";

export const dynamic = "force-dynamic";
export default async function NewBookPage() {
  const { context, locale, copy: t } = await libraryPageContext();
  return <SystemShell current="library" lang={locale} width="wide" pageClassName="library-page library-reading-page">
    <Link prefetch={false} className="ui-button library-back" href="/library">{t.back}</Link>
    {context.outcome === "success" ? <LibraryCreateForm key={context.userId} userId={context.userId} /> : <LibraryFeedback failure={context} copy={t} />}
  </SystemShell>;
}
