// Writes the AltStore source (altstore.json) for a release: the new version first, then the
// versions of the previous source (when given), so AltStore shows the whole history.
//
//   node altstore-source.mjs --out altstore.json --ipa kanso.ipa --version 0.2.0 --build 102 \
//     --url https://github.com/.../kanso-0.2.0.ipa [--previous old.json] [--notes "..."]
import { readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({
  options: {
    out: { type: 'string' },
    ipa: { type: 'string' },
    version: { type: 'string' },
    build: { type: 'string' },
    url: { type: 'string' },
    previous: { type: 'string' },
    notes: { type: 'string', default: '' },
    repo: { type: 'string', default: 'Rhombicdodecahedron/kanso' },
  },
});
for (const k of ['out', 'ipa', 'version', 'build', 'url']) if (!a[k]) throw new Error(`--${k} is required`);

const raw = `https://raw.githubusercontent.com/${a.repo}/main`;
const accent = '#E8B04B';

const previous = a.previous && existsSync(a.previous) ? JSON.parse(readFileSync(a.previous, 'utf8')) : null;
const oldVersions = (previous?.apps?.[0]?.versions ?? []).filter((v) => v.version !== a.version);

const source = {
  name: 'Kanso',
  identifier: 'com.alexiss.kanso.source',
  subtitle: 'A calm manga reader',
  description: 'Releases of Kanso, built from github.com/' + a.repo + '.',
  iconURL: `${raw}/apps/reader/assets/icon.png`,
  website: `https://github.com/${a.repo}`,
  tintColor: accent,
  featuredApps: ['com.alexiss.kanso'],
  apps: [
    {
      name: 'Kanso',
      bundleIdentifier: 'com.alexiss.kanso',
      developerName: 'Rhombicosidodecahedron',
      subtitle: 'A calm manga reader',
      localizedDescription: 'Read manga, manhwa and webtoons from the sources you add. Library, history, downloads, and a reader with paged, vertical and webtoon modes.',
      iconURL: `${raw}/apps/reader/assets/icon.png`,
      tintColor: accent,
      category: 'entertainment',
      screenshots: ['1-library', '2-manga', '3-reader', '4-history'].map((n) => ({ imageURL: `${raw}/docs/screenshots/${n}.jpg`, width: 1320, height: 2868 })),
      versions: [
        {
          version: a.version,
          buildVersion: a.build,
          date: new Date().toISOString(),
          localizedDescription: a.notes,
          downloadURL: a.url,
          size: statSync(a.ipa).size,
          minOSVersion: '16.4',
        },
        ...oldVersions,
      ],
      appPermissions: { entitlements: [], privacy: {} },
    },
  ],
  news: [],
};

writeFileSync(a.out, JSON.stringify(source, null, 2) + '\n');
console.log(`Wrote ${a.out}: ${source.apps[0].versions.length} version(s), latest ${a.version} (${a.build})`);
