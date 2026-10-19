![Kanso](docs/brand/banner.png)

# Kanso

A manga reader for iOS, Android and the web, modelled on [Mihon](https://github.com/mihonapp/mihon), which runs
Mihon's own extension ecosystem. Kotlin extensions from
[keiyoushi/extensions-source](https://github.com/keiyoushi/extensions-source) are translated
mechanically into JavaScript bundles, which the app downloads from a repository and runs.

<p>
  <img src="docs/screenshots/1-library.jpg" width="200" alt="Library">
  <img src="docs/screenshots/2-manga.jpg" width="200" alt="Series">
  <img src="docs/screenshots/3-reader.jpg" width="200" alt="Reader">
  <img src="docs/screenshots/4-history.jpg" width="200" alt="History">
</p>

## Install

Each [release](https://github.com/Rhombicdodecahedron/kanso/releases/latest) has:

- **Android:** `kanso-<version>.apk`. Download it and open it to install.
- **iPhone / iPad:** add this source in [AltStore](https://altstore.io) or [SideStore](https://sidestore.io), which also installs updates:

  ```
  https://github.com/Rhombicdodecahedron/kanso/releases/latest/download/altstore.json
  ```

  Or sideload `kanso-<version>.ipa` with [Sideloadly](https://sideloadly.io).

## Layout

| Path | What |
|---|---|
| `packages/source-api` | Runtime that translated extensions run against: Kotlin stdlib and coroutines, Jsoup (parse5 + css-select), OkHttp (async interceptors), kotlinx.serialization (JSON, Protobuf), java.time/text, crypto, keiyoushi `core`, Mihon's model and `KeiSource`. `host.ts` is the API the app uses. |
| `packages/translator` | Kotlin → JS compiler (tree-sitter-kotlin) plus a CLI that translates the whole repo and writes bundles, `index.min.json` and a compatibility report. |
| `packages/harness` | Runs bundles against live sites (popular → details → pages → image). Also a dev server for a repo. |
| `packages/core` | The app itself, free of any platform: domain, use cases, sync (merge rules and protocol) and every port the outside world plugs into. |
| `packages/sqlite` | The persistence adapter shared by every device: schema, migrations, repositories and sync change tracking, over a small `SqlDriver` port. |
| `packages/source-gateway` | The `SourceGateway` adapter over `source-api`; each app brings its own network transport, cookie jar and preference storage. |
| `packages/transport` | Network transports: plain fetch (server, harness), the web proxy's wire format and its browser client. |
| `packages/http` | Extension repositories and the sync server over HTTP, shared by both apps. |
| `packages/sync-turso` | The sync server's store on Turso / libSQL. |
| `apps/reader` | Expo / React Native app (library, history, browse, extensions, reader, downloads). |
| `apps/web` | Next.js web app: the same app in a browser, plus the source proxy and the sync server. |
| `docs/runtime-conventions.md` | How translated code and the runtime agree on representations. |

## Translating extensions

```bash
git clone --depth 1 https://github.com/keiyoushi/extensions-source ../extensions-source
cd packages/translator
npx tsx src/cli.ts --src ../../../extensions-source --out ../../repo
cat ../../repo/report.md        # what translated, top reasons for what didn't
```

The translator is deterministic. An extension either translates completely or is rejected with a
reason, such as an unsupported Kotlin construct or a runtime API that isn't implemented yet. The
report ranks those reasons, which shows what to implement next.

## Testing against live sites

```bash
cd packages/harness
npx tsx src/cli.ts ../../repo/eu.kanade.tachiyomi.extension.en.gourmetscans.js
npx tsx src/batch.ts --theme madara --limit 100     # writes repo/harness.json
```

## Running the app

```bash
cd packages/harness && npx tsx src/serve.ts ../../repo 8787   # serve the repo (+ /log for dev)
cd apps/reader && npx expo run:ios                             # dev build on a simulator
```

In the app, go to Browse → Extensions → Repos and add `http://127.0.0.1:8787` (the simulator
shares the host's network). In dev builds the Library screen polls `repo/debug.json`. Writing
`{"id":"x1","route":"/browse"}` there opens that screen. Writing
`{"id":"x2","pkg":"<extension pkg>"}` runs install → popular → details → pages → image inside the
app and reports each step to `repo/device.log`.

## Web app and sync

Browsers cannot send the headers manga sites expect (Referer, cookies, User-Agent) and are stopped by
CORS, so the web app comes with its own server: a proxy for source requests and images, and the sync
endpoint. Your library lives in the browser (SQLite in WebAssembly, saved to IndexedDB); downloaded
chapters read offline.

Deploy `apps/web` on Vercel (Root Directory `apps/web`) with:

| Variable | What |
|---|---|
| `KANSO_TOKEN` | The access token you type once per browser, and in the iPhone app's Sync settings. At least 32 characters (`openssl rand -base64 33`). |
| `KANSO_SESSION_SECRET` | Signs browser sessions. At least 32 characters. |
| `SYNC_DATABASE_URL`, `SYNC_DATABASE_TOKEN` | A [Turso](https://turso.tech) database (`libsql://…`) and its token. Leave unset to run without sync. |

Sync keeps the library, categories, reading progress and history the same on every device: per
record, the latest change wins. In the iPhone app, Settings → Sync takes the web app's address and the
token. Installed extensions do not sync.

To run it locally:

```bash
cd apps/web
cp .env.example .env.local      # fill in the tokens; SYNC_DATABASE_URL=file:.data/sync.db works locally
npm run dev
```

## Checks

```bash
npm run typecheck && npm test
cd apps/reader && npx expo lint
cd apps/web && npm run lint && npm run build
```

## Licence notes

Mihon and keiyoushi/extensions-source are Apache-2.0. Translated bundles are derivative works of
those extensions. See `NOTICE`. Kanso is not affiliated with Mihon.
