// Keeps the "Continue reading" widget on the chapter to resume: the latest history entry, or the
// chapter after it once that one is finished. While reading, the widget shows a strip of the
// current page (where the reader is in it); otherwise the cover. A no-op where widgets are not
// available.
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { widgetsDirectory } from 'expo-widgets';
import { Platform } from 'react-native';

import type { UseCases } from '@/core/application';
import type { SourceGateway } from '@/core/application/ports';
import type { Chapter, Manga } from '@/core/domain/model';

import ContinueReading, { type ContinueReadingProps } from './ContinueReading';

const EMPTY: ContinueReadingProps = { empty: true, title: '', chapter: '', page: '', progress: 0, image: '', url: 'kanso://' };
const enabled = Platform.OS === 'ios' && !!widgetsDirectory;

/** What the reader shows right now. */
export interface Seen {
  chapterId: number;
  total: number;
  page: number;
  /** how far down the page the reader is (0..1, webtoon) */
  offset: number;
  /** where the page image is: a local file, or a URL and the headers to fetch it with */
  image: () => Promise<{ uri: string; headers?: Record<string, string> }>;
}

/** Page counts seen by the reader (not stored in the database). */
const totals = new Map<number, number>();
/** The latest page snapshot made for the widget. */
let snapshot: { chapterId: number; page: number; offset: number; uri: string } | null = null;
let last = '';

/**
 * Updates the widget. Pass `seen` from the reader; without it the widget is rebuilt from history
 * (after history changes, at startup).
 */
export async function syncWidget(uc: UseCases, sources: SourceGateway, seen?: Seen): Promise<void> {
  if (!enabled) return;
  try {
    if (seen) totals.set(seen.chapterId, seen.total);
    await push(uc, sources);
    if (seen) schedule(uc, sources, seen);
  } catch (e) {
    console.warn('[widget]', e);
  }
}

async function push(uc: UseCases, sources: SourceGateway) {
  const props = await current(uc, sources);
  const key = JSON.stringify(props);
  if (key === last) return;
  last = key;
  ContinueReading.updateSnapshot(props);
}

// The page snapshot is made once the reader has settled on a page, one at a time.
let timer: ReturnType<typeof setTimeout> | null = null;
let busy = false;
let queued: (() => Promise<void>) | null = null;
function schedule(uc: UseCases, sources: SourceGateway, seen: Seen) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const job = async () => {
      const uri = await snapshotOf(seen);
      if (!uri) return;
      snapshot = { chapterId: seen.chapterId, page: seen.page, offset: seen.offset, uri };
      await push(uc, sources);
    };
    if (busy) queued = job;
    else void run(job);
  }, 1500);
}
async function run(job: () => Promise<void>) {
  busy = true;
  try {
    await job();
  } catch (e) {
    console.warn('[widget] page snapshot', e);
  } finally {
    busy = false;
    const next = queued;
    queued = null;
    if (next) void run(next);
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
  const shot = snapshot && snapshot.chapterId === chapter.id ? snapshot.uri : null;
  return {
    empty: false,
    title: manga.title,
    chapter: chapter.name,
    page: finished ? 'Finished' : total ? `Page ${page + 1} of ${total}` : page > 0 ? `Page ${page + 1}` : 'Not started',
    progress: finished ? 1 : total ? (page + 1) / total : 0,
    image: shot ?? (await cover(manga, sources)),
    url: `kanso://reader/${chapter.id}`,
  };
}

function dir(): Directory {
  const d = new Directory(widgetsDirectory.startsWith('file://') ? widgetsDirectory : `file://${widgetsDirectory}`);
  if (!d.exists) d.create({ intermediates: true });
  return d;
}

/** The cover, copied into the app group directory the widget can read (downloaded once). */
async function cover(manga: Manga, sources: SourceGateway): Promise<string> {
  if (!manga.thumbnailUrl) return '';
  try {
    const file = new File(dir(), `cover-${manga.id}.img`);
    if (!file.exists) {
      const headers = sources.has(manga.sourceId) ? sources.headers(manga.sourceId) : {};
      await File.downloadFileAsync(manga.thumbnailUrl, file, { headers, idempotent: true });
    }
    return file.uri;
  } catch {
    return '';
  }
}

/** Widget-shaped strip of the page around the reading position, small enough for the widget. */
const STRIP_RATIO = 2.1; // medium widget width / height
const STRIP_WIDTH = 720;
async function snapshotOf(seen: Seen): Promise<string | null> {
  if (snapshot && snapshot.chapterId === seen.chapterId && snapshot.page === seen.page && Math.abs(snapshot.offset - seen.offset) < 0.05) return null;
  const { uri, headers } = await seen.image();
  let source = uri;
  if (!uri.startsWith('file://')) {
    const tmp = new File(Paths.cache, 'widget-page.img');
    await File.downloadFileAsync(uri, tmp, { headers, idempotent: true });
    source = tmp.uri;
  }
  const full = await ImageManipulator.manipulate(source).renderAsync();
  const width = full.width;
  const height = Math.min(full.height, Math.round(width / STRIP_RATIO));
  // webtoon: where the reader is; a manga page: its upper part, where panels usually start
  const anchor = seen.offset > 0 ? seen.offset * full.height : (full.height - height) * 0.3;
  const top = Math.round(Math.max(0, Math.min(full.height - height, anchor)));
  const strip = await ImageManipulator.manipulate(source)
    .crop({ originX: 0, originY: top, width, height })
    .resize({ width: Math.min(STRIP_WIDTH, width) })
    .renderAsync();
  const saved = await strip.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
  // a new name each time, so the widget does not keep showing a cached image
  const out = new File(dir(), `page-${Date.now()}.jpg`);
  new File(saved.uri).move(out);
  for (const f of dir().list()) if (f instanceof File && f.name.startsWith('page-') && f.name !== out.name) f.delete();
  return out.uri;
}
