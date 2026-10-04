import * as Crypto from 'expo-crypto';

import type { ExtensionFetcher } from '@/core/application/ports';

/** Reads static extension repos: `<repo>/index.min.json` + bundle files next to it. */
export class HttpExtensionFetcher implements ExtensionFetcher {
  async index(repoUrl: string) {
    const res = await fetch(`${repoUrl}/index.min.json`, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) throw new Error(`Repository answered HTTP ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error('Not an extension index');
    return list.map((e: any) => ({
      pkg: String(e.pkg),
      name: String(e.name),
      file: String(e.file ?? `${e.pkg}.js`),
      lang: String(e.lang),
      version: String(e.version),
      nsfw: !!e.nsfw,
      sha256: String(e.sha256),
      size: Number(e.size ?? 0),
      theme: e.theme ?? null,
      sources: (e.sources ?? []).map((s: any, index: number) => ({ id: String(s.id), name: String(s.name), lang: String(s.lang), baseUrl: String(s.baseUrl ?? ''), index })),
    }));
  }
  async bundle(repoUrl: string, file: string): Promise<string> {
    const res = await fetch(`${repoUrl}/${file}`);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    return res.text();
  }
  sha256(text: string): Promise<string> {
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
  }
}
