"use client";

import { useEffect, useRef, useState } from "react";
import { entryImages } from "../../lib/journal-images";
import type { JournalEntrySummary, JournalReader } from "../../lib/local-vault";

export function JournalEntryImage({ entry, reader, alt, language, onSelect, compact = false }: {
  entry: JournalEntrySummary;
  reader: JournalReader;
  alt: string;
  language: "ko" | "en";
  compact?: boolean;
  onSelect?: (src: string, alt: string, gallery?: Array<{ src: string; alt: string }>, index?: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ version: string; sources?: string[]; failed?: boolean } | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let controller: AbortController | undefined;
    let disposed = false;
    const updateVisibility = (visible: boolean) => {
      if (disposed) return;
      if (!visible) {
        controller?.abort();
        controller = undefined;
        setState(null);
        return;
      }
      if (controller) return;
      const current = new AbortController();
      controller = current;
      void reader.images(entry, { signal: current.signal }).then((images) => {
        if (!current.signal.aborted) setState({ version: entry.contentVersion, sources: images.map((image) => image.dataUrl) });
      }).catch(() => {
        if (!current.signal.aborted) setState({ version: entry.contentVersion, failed: true });
      });
    };
    const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(
      ([item]) => updateVisibility(item.isIntersecting), { rootMargin: "0px" },
    );
    const metadata = entryImages(entry);
    if (compact) element.style.aspectRatio = "auto";
    else if (metadata.length === 1) element.style.aspectRatio = `${metadata[0].width} / ${metadata[0].height}`;
    else element.style.aspectRatio = "16 / 9";
    if (observer) observer.observe(element);
    else queueMicrotask(() => updateVisibility(true));
    return () => { disposed = true; observer?.disconnect(); controller?.abort(); };
  }, [compact, entry, reader, retry]);

  const current = state?.version === entry.contentVersion ? state : null;
  const metadata = entryImages(entry);
  const gallery = current?.sources?.map((src, index) => ({ src, alt: `${alt} ${index + 1}` }));
  return (
    <div ref={container} className={compact ? "entry-image-shell quote-photo" : `entry-image-shell photo-grid photo-grid-${metadata.length}`}>
      {compact ? gallery?.[0] ? <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="entry-image" src={gallery[0].src} alt={alt} decoding="async" />
        {metadata.length > 1 ? <span className="quote-photo-count">+{metadata.length - 1}</span> : null}
      </> : <span className="photo-placeholder">{current?.failed ? language === "ko" ? "원문에서 사진 보기" : "View photo in original" : language === "ko" ? "사진" : "Photo"}</span>
      : gallery ? gallery.map((image, index) => (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img key={metadata[index].id ?? index} className="entry-image" src={image.src} alt={image.alt} decoding="async" tabIndex={0} role="button"
          aria-label={`${language === "ko" ? "사진 원본 확대해 보기" : "Enlarge photo"} ${index + 1}`}
          onClick={() => onSelect?.(image.src, image.alt, gallery, index)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect?.(image.src, image.alt, gallery, index); }
          }} />
      )) : current?.failed ? (
        <button type="button" onClick={() => setRetry((value) => value + 1)}>
          {language === "ko" ? "사진 다시 불러오기" : "Retry photo"}
        </button>
      ) : <span className="photo-placeholder">{language === "ko" ? "사진" : "Photo"}</span>}
    </div>
  );
}
