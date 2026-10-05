// Keeps the "Continue reading" widget on the chapter to resume: the latest history entry, or the
// chapter after it once that one is finished. A no-op where widgets are not available.
import { Directory, File } from 'expo-file-system';
import { widgetsDirectory } from 'expo-widgets';
import { Platform } from 'react-native';

import type { UseCases } from '@/core/application';
import type { SourceGateway } from '@/core/application/ports';
import type { Chapter, Manga } from '@/core/domain/model';

import ContinueReading, { type ContinueReadingProps } from './ContinueReading';

const EMPTY: ContinueReadingProps = { empty: true, title: '', chapter: '', page: '', progress: 0, cover: '', url: 'kanso://' };
const enabled = Platform.OS === 'ios' && !!widgetsDirectory;

/** Page counts seen by the reader (not stored in the database). */
const totals = new Map<number, number>();
let last = '';

/**
 * Updates the widget. `seen` is what the reader shows right now, so the widget can show the page
 * count; without it, the widget is rebuilt from history (after history changes, at startup).
 */
export async function syncWidget(uc: UseCases, sources: SourceGateway, seen?: { chapterId: number; total: number }): Promise<void> {
  if (!enabled) return;
  try {
    if (seen) totals.set(seen.chapterId, seen.total);
    const props = await current(uc, sources);
    const key = JSON.stringify(props);
    if (key === last) return;
    last = key;
    ContinueReading.updateSnapshot(props);
  } catch (e) {
    console.warn('[widget]', e);
  }
}

async function current(uc: UseCases, sources: SourceGateway): Promise<ContinueReadingProps> {
  const [latest] = await uc.library.history(1);
  if (!latest) return EMPTY;
  const { manga } = latest;
  let chapter: Chapter = latest.chapter;
  let page = chapter.read ? 0 : chapter.lastPageRead;
  if (chapter.read) {
    // finished: resume with the next chapter, if there is one
    const { chapters } = await uc.catalog.manga(manga.id);
    const sorted = [...chapters].sort((a, b) => b.sourceOrder - a.sourceOrder);
    const next = sorted[sorted.findIndex((c) => c.id === chapter.id) + 1];
    if (next) {
      chapter = next;
      page = next.read ? 0 : next.lastPageRead;
    }
  }
  const total = totals.get(chapter.id);
  const finished = chapter.read && chapter.id === latest.chapter.id;
  return {
    empty: false,
    title: manga.title,
    chapter: chapter.name,
    page: finished ? 'Finished' : total ? `Page ${page + 1} of ${total}` : page > 0 ? `Page ${page + 1}` : 'Not started',
    progress: finished ? 1 : total ? (page + 1) / total : 0,
    cover: await cover(manga, sources),
    url: `kanso://reader/${chapter.id}`,
  };
}

/** The cover, copied into the app group directory the widget can read (downloaded once). */
async function cover(manga: Manga, sources: SourceGateway): Promise<string> {
  if (!manga.thumbnailUrl) return '';
  try {
    const dir = new Directory(widgetsDirectory.startsWith('file://') ? widgetsDirectory : `file://${widgetsDirectory}`);
    if (!dir.exists) dir.create({ intermediates: true });
    const file = new File(dir, `cover-${manga.id}.img`);
    if (!file.exists) {
      const headers = sources.has(manga.sourceId) ? sources.headers(manga.sourceId) : {};
      await File.downloadFileAsync(manga.thumbnailUrl, file, { headers, idempotent: true });
    }
    return file.uri;
  } catch {
    return '';
  }
}
