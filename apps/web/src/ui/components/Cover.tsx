import Link from 'next/link';

/** A series as a cover: the image carries the grid, the title sits underneath. */
export function Cover({ href, title, src, badge, inLibrary }: { href: string; title: string; src: string | null; badge?: number; inLibrary?: boolean }) {
  return (
    <Link href={href} className="cover">
      <span className="cover-art">
        {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <span className="cover-fallback">{title.slice(0, 1)}</span>}
        {badge ? <span className="cover-badge">{badge}</span> : null}
        {inLibrary ? <span className="cover-flag">In library</span> : null}
      </span>
      <span className="cover-title">{title}</span>
    </Link>
  );
}

export function CoverGrid({ children }: { children: React.ReactNode }) {
  return <div className="cover-grid">{children}</div>;
}
