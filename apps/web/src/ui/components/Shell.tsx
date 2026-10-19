'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Icon, type IconName } from './Icon';

const NAV: { href: string; label: string; icon: IconName; primary: boolean }[] = [
  { href: '/', label: 'Library', icon: 'library', primary: true },
  { href: '/history', label: 'History', icon: 'history', primary: true },
  { href: '/browse', label: 'Browse', icon: 'browse', primary: true },
  { href: '/downloads', label: 'Downloads', icon: 'downloads', primary: false },
  { href: '/settings', label: 'Settings', icon: 'settings', primary: true },
];

const active = (path: string, href: string) => (href === '/' ? path === '/' : path.startsWith(href));

/** Left rail on wide screens, tab bar on phones. The reader opts out of both. */
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  if (path.startsWith('/reader')) return <>{children}</>;
  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <Link href="/" className="rail-mark" aria-label="Kanso">
          간
        </Link>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="rail-item" aria-current={active(path, n.href) ? 'page' : undefined}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </Link>
        ))}
      </nav>
      <div className="shell-main">{children}</div>
      <nav className="tabs" aria-label="Main">
        {NAV.filter((n) => n.primary).map((n) => (
          <Link key={n.href} href={n.href} className="tab" aria-current={active(path, n.href) ? 'page' : undefined}>
            <Icon name={n.icon} size={22} />
            <span>{n.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function PageHeader({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head-row">
        <h1>{title}</h1>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

export function Chip({ active, children, onClick }: { active?: boolean; children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className="chip" aria-pressed={!!active} onClick={onClick}>
      {children}
    </button>
  );
}

export function IconButton({ icon, label, onClick, active, disabled, filled }: { icon: IconName; label: string; onClick?: () => void; active?: boolean; disabled?: boolean; filled?: boolean }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} aria-pressed={active} disabled={disabled} onClick={onClick}>
      <Icon name={icon} filled={filled} />
    </button>
  );
}
