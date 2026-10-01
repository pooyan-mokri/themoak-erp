'use client';

import * as React from 'react';

/**
 * A product's photo, or `fallback` when it has none or the photo does not load:
 * photos linked from the old WordPress store (themoak.com/wp-content/…) now
 * answer 404, and every screen that shows a product photo shows its neutral
 * placeholder instead of a broken image. A plain <img>: for a photo on this
 * ERP it carries the session, and a change of image host can never break the
 * page the way next/image would.
 */
export function ProductPhoto({
  src,
  alt,
  className,
  loading,
  fallback,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  /** Shown in place of the photo: the screen's own placeholder. */
  fallback: React.ReactNode;
}) {
  const [failed, setFailed] = React.useState(false);
  const image = React.useRef<HTMLImageElement>(null);
  React.useEffect(() => {
    setFailed(false);
    // A photo that failed before the page came alive fired its error before React listened.
    const node = image.current;
    if (node && node.complete && node.naturalWidth === 0) setFailed(true);
  }, [src]);

  if (!src || failed) {
    return (
      <span data-photo-fallback className="contents">
        {fallback}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} src={src} alt={alt} loading={loading} className={className} onError={() => setFailed(true)} />;
}
