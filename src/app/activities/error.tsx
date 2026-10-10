"use client";
import Link from "next/link";
import { Button, Notice } from "@/components/ui/primitives";
import { useLocale } from "@/lib/localization/provider";
import { aoCopy } from "@/features/activities-opportunities/ui/ui-copy";

export default function ErrorBoundary({ reset }: { reset: () => void }) {
  const { locale } = useLocale();
  const t = aoCopy[locale];
  return <main className="page-frame" lang={locale}><Notice tone="danger" role="alert">
    <p>{t.error}</p><div className="flex flex-wrap gap-2 mt-3">
      <Button onClick={reset}>{t.retry}</Button>
      <Link prefetch={false} className="ui-button" href="/activities">{t.back}</Link>
    </div>
  </Notice></main>;
}
