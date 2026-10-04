import { Directory, File, Paths } from 'expo-file-system';

import type { BundleStore, PageStore } from '@/core/application/ports';

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
  async write(chapterId: number, index: number, bytes: Uint8Array, ext: string): Promise<void> {
    const f = new File(ensure(this.dir(chapterId)), `${String(index).padStart(4, '0')}.${ext}`);
    if (f.exists) f.delete();
    f.create();
    f.write(bytes);
  }
  async list(chapterId: number): Promise<string[]> {
    const d = this.dir(chapterId);
    if (!d.exists) return [];
    return d
      .list()
      .filter((x): x is File => x instanceof File)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => f.uri);
  }
  async remove(chapterId: number): Promise<void> {
    const d = this.dir(chapterId);
    if (d.exists) d.delete();
  }
}
