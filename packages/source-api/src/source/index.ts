// eu.kanade.tachiyomi.source.* + keiyoushi.source.KeiSource

import { md5 } from '@noble/hashes/legacy.js';
import { IllegalStateException, UnsupportedOperationException } from '../kotlin/core';
import { FilterList, MangasPage, type Page, type SChapter, type SManga, SMangaUpdate } from '../model';
import { GET, Headers, HeadersBuilder, OkHttpClient, OkHttpClientBuilder, type Request, type Response, type Transport, MemoryCookieJar, type CookieJar } from '../okhttp';
import { parseHttpUrl, toHttpUrlOrNull, type HttpUrl } from '../okhttp/url';
import { JsonNull } from '../serialization/json';
import { SharedPreferences, type PrefStore } from './preferences';

// ---------- host services ----------

/** Everything a running source needs from its host (Node harness or the app). */
export interface SourceHost {
  transport: Transport;
  cookieJar: CookieJar;
  userAgent: string;
  /** Preference storage for a source id. */
  prefs(sourceId: string): PrefStore;
  log(level: 'debug' | 'info' | 'warn' | 'error', tag: string, msg: string): void;
  /** Called when a request is blocked by a Cloudflare challenge; returns true if solved. */
  solveChallenge?(url: string, userAgent: string): Promise<boolean>;
}

let currentHost: SourceHost | null = null;
export function setHost(h: SourceHost): void {
  currentHost = h;
}
export function host(): SourceHost {
  if (!currentHost) throw new IllegalStateException('Source host not initialised');
  return currentHost;
}

/** eu.kanade.tachiyomi.network.NetworkHelper */
export class NetworkHelper {
  private base: OkHttpClient | null = null;
  get client(): OkHttpClient {
    if (!this.base) {
      const h = host();
      const b = new OkHttpClientBuilder();
      b.cfg.transport = h.transport;
      b.cfg.cookieJar = h.cookieJar;
      b.addInterceptor(userAgentInterceptor);
      b.addInterceptor(cloudflareInterceptor);
      this.base = b.build();
    }
    return this.base;
  }
  get cloudflareClient(): OkHttpClient {
    return this.client;
  }
  get cookieJar(): CookieJar {
    return host().cookieJar;
  }
  defaultUserAgentProvider(): string {
    return host().userAgent;
  }
}

const userAgentInterceptor = Object.assign(
  async (chain: any) => {
    const req: Request = chain.request();
    if (req.header('User-Agent')) return chain.proceed(req);
    return chain.proceed(req.newBuilder().header('User-Agent', host().userAgent).build());
  },
  { $name: 'UserAgentInterceptor' },
);

const CF_SERVERS = ['cloudflare-nginx', 'cloudflare'];
const cloudflareInterceptor = Object.assign(
  async (chain: any) => {
    const req: Request = chain.request();
    const res: Response = await chain.proceed(req);
    const blocked = (res.code === 403 || res.code === 503) && CF_SERVERS.includes((res.header('Server') ?? '').toLowerCase());
    if (!blocked) return res;
    const h = host();
    if (!h.solveChallenge) return res;
    const ok = await h.solveChallenge(req.url.toString(), req.header('User-Agent') ?? h.userAgent);
    if (!ok) throw new CloudflareBlockedException(req.url.toString());
    return chain.proceed(req);
  },
  { $name: 'CloudflareInterceptor' },
);

export class CloudflareBlockedException extends IllegalStateException {
  constructor(readonly url: string) {
    super('Failed to bypass Cloudflare');
  }
}

export const network = new NetworkHelper();

// ---------- ids ----------

/** Mihon's HttpSource.generateId: first 8 bytes of MD5("name/lang/versionId") as a positive Long. */
export function generateId(name: string, lang: string, versionId: number): string {
  const key = `${name.toLowerCase()}/${lang}/${versionId}`;
  const bytes = md5(new TextEncoder().encode(key));
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(bytes[i]);
  return (v & 0x7fffffffffffffffn).toString();
}

// ---------- source classes ----------

/** Marker interfaces. */
export class Source {
  static $interface = true;
}
export class CatalogueSource {
  static $interface = true;
}
export class ConfigurableSource {
  static $interface = true;
}
export class UnmeteredSource {
  static $interface = true;
}

/**
 * eu.kanade.tachiyomi.source.online.HttpSource - legacy request/parse API (lib 1.4). The
 * generated source subclass provides `name`, `lang`, `baseUrl` (and maybe `id`).
 */
export class HttpSource {
  get network(): NetworkHelper {
    return network;
  }
  get versionId(): number {
    return 1;
  }
  get id(): string {
    return generateId(this.name, this.lang, this.versionId);
  }
  get name(): string {
    throw new UnsupportedOperationException('name not set');
  }
  get lang(): string {
    throw new UnsupportedOperationException('lang not set');
  }
  get baseUrl(): string {
    throw new UnsupportedOperationException('baseUrl not set');
  }
  get supportsLatest(): boolean {
    return true;
  }
  private $headers?: Headers;
  get headers(): Headers {
    if (!this.$headers) this.$headers = this.headersBuilder().build();
    return this.$headers;
  }
  get client(): OkHttpClient {
    return this.network.client;
  }
  headersBuilder(): HeadersBuilder {
    return new HeadersBuilder().add('User-Agent', this.network.defaultUserAgentProvider());
  }
  toString(): string {
    return `${this.name} (${this.lang.toUpperCase()})`;
  }
  generateId(name: string, lang: string, versionId: number): string {
    return generateId(name, lang, versionId);
  }

  /** `fun SManga.setUrlWithoutDomain(url)` / `SChapter.setUrlWithoutDomain(url)` */
  setUrlWithoutDomain$ext(target: any, url: string): void {
    target.url = this.getUrlWithoutDomain(url);
  }
  getUrlWithoutDomain(orig: string): string {
    const u = parseHttpUrl(orig.replace(/ /g, '%20'));
    if (!u) return orig;
    let out = u.encodedPath;
    if (u.encodedQuery !== null) out += '?' + u.encodedQuery;
    if (u.encodedFragment !== null) out += '#' + u.encodedFragment;
    return out;
  }

  // --- legacy API: request/parse pairs, overridden by 1.4 sources ---
  popularMangaRequest(_page: number): Request {
    throw new UnsupportedOperationException('popularMangaRequest');
  }
  popularMangaParse(_r: Response): MangasPage {
    throw new UnsupportedOperationException('popularMangaParse');
  }
  latestUpdatesRequest(_page: number): Request {
    throw new UnsupportedOperationException('latestUpdatesRequest');
  }
  latestUpdatesParse(_r: Response): MangasPage {
    throw new UnsupportedOperationException('latestUpdatesParse');
  }
  searchMangaRequest(_page: number, _q: string, _f: any[]): Request {
    throw new UnsupportedOperationException('searchMangaRequest');
  }
  searchMangaParse(_r: Response): MangasPage {
    throw new UnsupportedOperationException('searchMangaParse');
  }
  mangaDetailsRequest(manga: SManga): Request {
    return GET(this.baseUrl + manga.url, this.headers);
  }
  mangaDetailsParse(_r: Response): SManga {
    throw new UnsupportedOperationException('mangaDetailsParse');
  }
  chapterListRequest(manga: SManga): Request {
    return this.mangaDetailsRequest(manga);
  }
  chapterListParse(_r: Response): SChapter[] {
    throw new UnsupportedOperationException('chapterListParse');
  }
  chapterPageParse(_r: Response): SChapter {
    throw new UnsupportedOperationException('chapterPageParse');
  }
  pageListRequest(chapter: SChapter): Request {
    return GET(this.baseUrl + chapter.url, this.headers);
  }
  pageListParse(_r: Response): Page[] {
    throw new UnsupportedOperationException('pageListParse');
  }
  imageUrlRequest(page: Page): Request {
    return GET(page.url, this.headers);
  }
  imageUrlParse(_r: Response): string {
    throw new UnsupportedOperationException('imageUrlParse');
  }
  imageRequest(page: Page): Request {
    return GET(page.imageUrl!, this.headers);
  }

  async getPopularManga(page: number): Promise<MangasPage> {
    const r = await this.client.newCall(this.popularMangaRequest(page)).awaitSuccess();
    return this.popularMangaParse(r);
  }
  async getLatestUpdates(page: number): Promise<MangasPage> {
    const r = await this.client.newCall(this.latestUpdatesRequest(page)).awaitSuccess();
    return this.latestUpdatesParse(r);
  }
  async getSearchManga(page: number, query: string, filters: any[]): Promise<MangasPage> {
    const r = await this.client.newCall(await this.searchMangaRequest(page, query, filters)).awaitSuccess();
    return this.searchMangaParse(r);
  }
  async getMangaDetails(manga: SManga): Promise<SManga> {
    const r = await this.client.newCall(this.mangaDetailsRequest(manga)).awaitSuccess();
    return this.mangaDetailsParse(r);
  }
  async getChapterList(manga: SManga): Promise<SChapter[]> {
    const r = await this.client.newCall(this.chapterListRequest(manga)).awaitSuccess();
    return this.chapterListParse(r);
  }
  async getMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    const details = fetchDetails ? await this.getMangaDetails(manga) : manga;
    const list = fetchChapters ? await this.getChapterList(manga) : chapters;
    return new SMangaUpdate(details, list);
  }
  async getPageList(chapter: SChapter): Promise<Page[]> {
    const r = await this.client.newCall(this.pageListRequest(chapter)).awaitSuccess();
    return this.pageListParse(r);
  }
  async getImageUrl(page: Page): Promise<string> {
    const r = await this.client.newCall(this.imageUrlRequest(page)).awaitSuccess();
    return this.imageUrlParse(r);
  }
  getMangaUrl(manga: SManga): string {
    return this.mangaDetailsRequest(manga).url.toString();
  }
  getChapterUrl(chapter: SChapter): string {
    return this.pageListRequest(chapter).url.toString();
  }
  prepareNewChapter(_chapter: SChapter, _manga: SManga): void {}
  getFilterList(): any[] {
    return FilterList();
  }
  get supportsRelatedMangas(): boolean {
    return false;
  }
  async fetchRelatedMangaList(_manga: SManga): Promise<SManga[]> {
    return [];
  }

  // Host-facing entry points (names the app calls, independent of overrides).
  $getFilterList(): any[] {
    return this.getFilterList();
  }
}

/** keiyoushi.source.KeiSource (lib 1.6). */
export class KeiSource extends HttpSource {
  private $client?: OkHttpClient;
  private $filterData: any = undefined;
  private $filterFetch: Promise<void> | null = null;

  /** `protected open fun OkHttpClient.Builder.configureClient()` - receiver passed first. */
  configureClient$ext(b: OkHttpClientBuilder): OkHttpClientBuilder {
    return b;
  }
  /** `protected open fun Headers.Builder.configureHeaders()` */
  configureHeaders$ext(b: HeadersBuilder): HeadersBuilder {
    return b;
  }

  get client(): OkHttpClient {
    if (!this.$client) {
      const b = this.network.client.newBuilder();
      b.cfg.source = this;
      const configured = this.configureClient$ext(b) ?? b;
      // Cloudflare interceptor must run after source interceptors.
      const ints = configured.cfg.interceptors;
      const cf = ints.findIndex((i: any) => i?.$name === 'CloudflareInterceptor' || i?.intercept?.$name === 'CloudflareInterceptor');
      if (cf >= 0) ints.push(ints.splice(cf, 1)[0]);
      this.$client = configured.build();
    }
    return this.$client;
  }

  get headers(): Headers {
    return this.headersBuilder().build();
  }

  headersBuilder(): HeadersBuilder {
    const b = super.headersBuilder().set('Referer', `${this.baseUrl}/`).set('Origin', this.baseUrl);
    return this.configureHeaders$ext(b) ?? b;
  }

  get supportsLatest(): boolean {
    return true;
  }

  async getPopularManga(_page: number): Promise<MangasPage> {
    throw new UnsupportedOperationException('getPopularManga');
  }
  async getLatestUpdates(_page: number): Promise<MangasPage> {
    throw new UnsupportedOperationException('getLatestUpdates');
  }
  async getSearchMangaList(_page: number, _query: string, _filters: any[]): Promise<MangasPage> {
    throw new UnsupportedOperationException('getSearchMangaList');
  }
  async getMangaByUrl(_url: HttpUrl): Promise<SManga | null> {
    throw new UnsupportedOperationException('getMangaByUrl not implemented');
  }
  async getMangasByUrl(url: HttpUrl, _page: number): Promise<MangasPage> {
    const manga = await this.getMangaByUrl(url);
    return new MangasPage(manga ? [manga] : [], false);
  }
  async getSearchManga(page: number, query: string, filters: any[]): Promise<MangasPage> {
    const url = toHttpUrlOrNull(query);
    if (url) return this.getMangasByUrl(url, page);
    return this.getSearchMangaList(page, query, filters);
  }
  async fetchMangaUpdate(_m: SManga, _c: SChapter[], _d: boolean, _ch: boolean): Promise<SMangaUpdate> {
    throw new UnsupportedOperationException('fetchMangaUpdate');
  }
  async getMangaUpdate(manga: SManga, chapters: SChapter[], fetchDetails: boolean, fetchChapters: boolean): Promise<SMangaUpdate> {
    if (!fetchDetails && !fetchChapters) throw new IllegalStateException('getMangaUpdate called with nothing to fetch');
    const u = await this.fetchMangaUpdate(manga, chapters, fetchDetails, fetchChapters);
    u.manga.initialized = true;
    return new SMangaUpdate(u.manga, u.chapters);
  }
  getHomeUrl(): string {
    return this.baseUrl;
  }
  getMangaUrl(manga: SManga): string {
    return this.baseUrl + manga.url;
  }
  getChapterUrl(chapter: SChapter): string {
    return this.baseUrl + chapter.url;
  }
  async getImageUrl(_page: Page): Promise<string> {
    throw new UnsupportedOperationException('getImageUrl');
  }
  imageRequest(page: Page): Request {
    return GET(page.imageUrl!, this.headers);
  }

  // --- filter fetching ---
  get supportsFilterFetching(): boolean {
    return false;
  }
  get filterFetchHint(): string {
    return "Tap 'Reset' to load filters";
  }
  async fetchFilterData(): Promise<any> {
    return JsonNull;
  }
  /** `getFilterList(data: JsonElement?)` - overridden by sources. */
  getFilterList(_data?: any): any[] {
    return FilterList();
  }
  $getFilterList(): any[] {
    if (!this.supportsFilterFetching) return this.getFilterList(null);
    if (this.$filterData === undefined) {
      void this.$fetchFilters();
      const base = [...this.getFilterList(null)];
      return base;
    }
    return this.getFilterList(this.$filterData);
  }
  /** Host calls this (and awaits) to make fetched filters available before showing them. */
  $fetchFilters(): Promise<void> {
    if (!this.supportsFilterFetching) return Promise.resolve();
    if (!this.$filterFetch) {
      this.$filterFetch = this.fetchFilterData().then(
        (d) => {
          this.$filterData = d;
        },
        (e) => {
          host().log('warn', this.name, `Failed to fetch filter data: ${e?.message ?? e}`);
          this.$filterFetch = null;
        },
      );
    }
    return this.$filterFetch;
  }
  $setFilterData(d: any): void {
    this.$filterData = d;
  }
  $filterDataValue(): any {
    return this.$filterData;
  }
}

/** eu.kanade.tachiyomi.source.online.ParsedHttpSource (deprecated, used by a few 1.4 sources). */
export class ParsedHttpSource extends HttpSource {}

export function getPreferencesFor(source: any): SharedPreferences {
  return SharedPreferences.forSource(String(source.id));
}
