import { MangaStatus } from '@/core/domain/model';

const STATUS: Record<number, string> = {
  [MangaStatus.UNKNOWN]: 'Unknown',
  [MangaStatus.ONGOING]: 'Ongoing',
  [MangaStatus.COMPLETED]: 'Completed',
  [MangaStatus.LICENSED]: 'Licensed',
  [MangaStatus.PUBLISHING_FINISHED]: 'Publishing finished',
  [MangaStatus.CANCELLED]: 'Cancelled',
  [MangaStatus.ON_HIATUS]: 'On hiatus',
};

export function statusLabel(s: number): string {
  return STATUS[s] ?? 'Unknown';
}

export function formatDate(ms: number, now = Date.now()): string {
  const days = Math.floor((now - ms) / 86_400_000);
  if (days < 1 && now >= ms) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return `${days} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatRelativeTime(ms: number, now = Date.now()): string {
  const min = Math.round((now - ms) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return formatDate(ms, now);
}
