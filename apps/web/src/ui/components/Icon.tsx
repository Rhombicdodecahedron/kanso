// A small stroke icon set, drawn for Kanso (24px grid, 1.75 stroke, round joins).

const paths = {
  library: 'M5 4h4v16H5zM11 4h4v16h-4zM17.2 5.2l3.6 1-3.8 14-3.6-1',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v4h4M12 7.5V12l3 2',
  browse: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5l-2 5-5 2 2-5z',
  downloads: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14',
  settings: 'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2l-.3 2h-4l-.3-2a7 7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-3l-1.6-1.2 2-3.4 1.9.7a7 7 0 0 1 2-1.2l.3-2h4l.3 2a7 7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 3z',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.3 15.3 20 20',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'M14.5 5.5 8 12l6.5 6.5',
  next: 'M9.5 5.5 16 12l-6.5 6.5',
  prevChapter: 'M17 6l-6 6 6 6M7 6v12',
  nextChapter: 'M7 6l6 6-6 6M17 6v12',
  bookmark: 'M7 4h10v16l-5-3.5L7 20z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  web: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 12h17M12 3c2.5 2.6 3.6 5.6 3.6 9s-1.1 6.4-3.6 9c-2.5-2.6-3.6-5.6-3.6-9S9.5 5.6 12 3z',
  sort: 'M8 4v16M4.5 16.5 8 20l3.5-3.5M16 20V4M12.5 7.5 16 4l3.5 3.5',
  trash: 'M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13',
  plus: 'M12 5v14M5 12h14',
  up: 'M6 14.5 12 8.5l6 6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  queued: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4.5l3 1.5',
  done: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM8.5 12.2l2.4 2.4 4.6-4.8',
  failed: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v5M12 16h.01',
  menu: 'M4 7h16M4 12h16M4 17h16',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 20, filled = false, className }: { name: IconName; size?: number; filled?: boolean; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
