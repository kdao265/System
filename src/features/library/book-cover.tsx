"use client";

import { useState } from "react";
import type { Dictionary } from "@/lib/localization/dictionaries";

export function BookCover({ url, copy }: { url: string | null; copy: Dictionary["library"] }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = !!url && failedUrl === url;
  return <div className="library-cover">
    {url && !failed ?
      // Native browser loading is deliberate: no server optimizer/proxy or host wildcard.
      // The adjacent title supplies identity; the cover is redundant for screen readers.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" width={240} height={360} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />
      : <div className="library-cover-fallback"><span className="library-cover-mark" aria-hidden="true" /><span>{failed ? copy.coverFailed : copy.coverMissing}</span></div>}
  </div>;
}
