import type { AvailableExtension, ExtensionRepo, InstalledExtension } from '../domain/model';
import type { Deps } from './ports';

export interface ExtensionListing {
  installed: (InstalledExtension & { update: AvailableExtension | null })[];
  available: AvailableExtension[];
  errors: { repoUrl: string; message: string }[];
}

export class IntegrityError extends Error {}

/** Compare "1.6.55" style versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function createExtensionUseCases(d: Deps) {
  async function install(ext: AvailableExtension): Promise<InstalledExtension> {
    const code = await d.fetcher.bundle(ext.repoUrl, ext.file);
    const hash = await d.fetcher.sha256(code);
    if (hash !== ext.sha256) throw new IntegrityError(`Checksum mismatch for ${ext.name}`);
    const installed: InstalledExtension = { ...ext, installedAt: d.clock.now() };
    await d.sources.load(installed, code);
    await d.bundles.write(ext.pkg, code);
    await d.extensions.save(installed);
    return installed;
  }

  return {
    repos: () => d.repos.list(),

    async addRepo(url: string): Promise<ExtensionRepo> {
      const clean = url.trim().replace(/\/index(\.min)?\.json$/, '').replace(/\/+$/, '');
      await d.fetcher.index(clean); // validates the repo answers
      const repo = { url: clean, name: clean.replace(/^https?:\/\//, ''), addedAt: d.clock.now() };
      await d.repos.add(repo);
      return repo;
    },

    removeRepo: (url: string) => d.repos.remove(url),

    /** Add the official repository once (first launch, or for users who only had a local one). */
    async ensureDefaultRepo(url: string): Promise<void> {
      const repos = await d.repos.list();
      if (repos.some((r) => r.url === url)) return;
      const seeded = await d.settings.get();
      if (seeded.seededRepos?.includes(url)) return; // user removed it on purpose
      await d.repos.add({ url, name: url.replace(/^https?:\/\//, ''), addedAt: d.clock.now() });
      await d.settings.save({ ...(await d.settings.get()), seededRepos: [...(seeded.seededRepos ?? []), url] });
    },

    async list(): Promise<ExtensionListing> {
      const repos = await d.repos.list();
      const installed = await d.extensions.list();
      const errors: ExtensionListing['errors'] = [];
      const remote: AvailableExtension[] = [];
      await Promise.all(
        repos.map(async (r) => {
          try {
            for (const e of await d.fetcher.index(r.url)) remote.push({ ...e, repoUrl: r.url });
          } catch (e) {
            errors.push({ repoUrl: r.url, message: e instanceof Error ? e.message : String(e) });
          }
        }),
      );
      const byPkg = new Map(remote.map((e) => [e.pkg, e]));
      const installedPkgs = new Set(installed.map((e) => e.pkg));
      return {
        installed: installed
          .map((e) => {
            const r = byPkg.get(e.pkg);
            // A rebuilt bundle (translator/runtime fix) keeps its version but changes its checksum.
            const newer = r && (compareVersions(r.version, e.version) > 0 || (compareVersions(r.version, e.version) === 0 && r.sha256 !== e.sha256));
            return { ...e, update: newer ? r : null };
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
        available: remote.filter((e) => !installedPkgs.has(e.pkg)).sort((a, b) => a.name.localeCompare(b.name)),
        errors,
      };
    },

    install,

    async uninstall(pkg: string): Promise<void> {
      d.sources.unload(pkg);
      await d.bundles.remove(pkg);
      await d.extensions.remove(pkg);
    },

    /** Load every installed bundle into the runtime (app start). Returns failures. */
    async loadInstalled(): Promise<{ pkg: string; message: string }[]> {
      const failures: { pkg: string; message: string }[] = [];
      for (const ext of await d.extensions.list()) {
        try {
          const code = await d.bundles.read(ext.pkg);
          if (!code) throw new Error('bundle missing');
          await d.sources.load(ext, code);
        } catch (e) {
          failures.push({ pkg: ext.pkg, message: e instanceof Error ? e.message : String(e) });
        }
      }
      return failures;
    },
  };
}
