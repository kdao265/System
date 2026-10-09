"use client";
import Link from "next/link";
import { Button, Notice } from "@/components/ui/primitives";
import { useLocale } from "@/lib/localization/provider";
export default function LibraryError({ reset }: { reset: () => void }) {
  const { messages: { library: t } } = useLocale();
  return <main className="page-frame"><Notice tone="danger" role="alert"><p>{t.unavailable}</p><Button onClick={reset}>{t.retry}</Button><Link prefetch={false} className="ui-button" href="/library">{t.back}</Link></Notice></main>;
}
