import { Directory, DownloadTask, File, Paths } from 'expo-file-system';

import type { BundleStore, PageStore } from '@/core/application/ports';
import type { ImageRequest } from '@/core/domain/model';

const bundlesDir = () => new Directory(Paths.document, 'extensions');
const downloadsDir = () => new Directory(Paths.document, 'downloads');

function ensure(dir: Directory): Directory {
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export class FsBundleStore implements BundleStore {
  async write(pkg: string, code: string): Promise<void> {
    const f = new File(ensure(bundlesDir()), `${pkg}.js`);
    if (f.exists) f.delete();
    f.create();
    f.write(code);
  }
  async read(pkg: string): Promise<string | null> {
    const f = new File(bundlesDir(), `${pkg}.js`);
    return f.exists ? f.text() : null;
  }
  async remove(pkg: string): Promise<void> {
    const f = new File(bundlesDir(), `${pkg}.js`);
    if (f.exists) f.delete();
  }
}

export class FsPageStore implements PageStore {
  private dir(chapterId: number): Directory {
    return new Directory(downloadsDir(), String(chapterId));
  }
  /** Page files are named by index (0007.jpg); a page has a single file whatever its format. */
  private fileFor(chapterId: number, index: number, ext: string): File {
    const dir = ensure(this.dir(chapterId));
    const name = String(index).padStart(4, '0');
    for (const f of dir.list()) if (f instanceof File && f.name.startsWith(`${name}.`) && !f.name.endsWith('.part')) f.delete();
    return new File(dir, `${name}.${ext}`);
  }
  async write(chapterId: number, index: number, bytes: Uint8Array, ext: string): Promise<void> {
    const f = this.fileFor(chapterId, index, ext);
    f.create();
    f.write(bytes);
  }
  async download(chapterId: number, index: number, req: ImageRequest, signal?: AbortSignal): Promise<void> {
    // Written to a temporary name and renamed once complete, so a page file is never partial.
    const dir = ensure(this.dir(chapterId));
    const part = new File(dir, `${String(index).padStart(4, '0')}.part`);
    if (part.exists) part.delete();
    // 'background': iOS keeps the transfer going while the app is suspended
    const task = new DownloadTask(req.url, part, { headers: req.headers, sessionType: 'background', signal });
    const file = await task.downloadAsync();
    if (!file) throw new Error('Download paused');
    const target = this.fileFor(chapterId, index, extOf(req.url));
    file.move(target, { overwrite: true });
  }
  async indexes(chapterId: number): Promise<Set<number>> {
    const d = this.dir(chapterId);
    if (!d.exists) return new Set();
    return new Set(
      d
        .list()
        .filter((x): x is File => x instanceof File && !x.name.endsWith('.part'))
        .map((f) => Number(f.name.split('.')[0]))
        .filter((n) => Number.isInteger(n)),
    );
  }
  async list(chapterId: number): Promise<string[]> {
    const d = this.dir(chapterId);
    if (!d.exists) return [];
    return d
      .list()
      .filter((x): x is File => x instanceof File && !x.name.endsWith('.part'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => f.uri);
  }
  async remove(chapterId: number): Promise<void> {
    const d = this.dir(chapterId);
    if (d.exists) d.delete();
  }
}

/** File extension from the image URL; the image decoder reads the real format from the data. */
function extOf(url: string): string {
  const m = /\.(jpe?g|png|webp|gif|avif|heic)(?:$|[?#])/i.exec(url);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}
