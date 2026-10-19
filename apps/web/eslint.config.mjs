import next from 'eslint-config-next';

const config = [
  { ignores: ['.next/*', 'next-env.d.ts', 'public/*'] },
  ...next,
  // Images already come through the app's own image proxy (or blob: URLs); next/image would
  // route them through a second, billed optimizer.
  { rules: { '@next/next/no-img-element': 'off' } },
];

export default config;
