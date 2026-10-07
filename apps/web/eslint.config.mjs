import next from 'eslint-config-next';

const config = [{ ignores: ['.next/*', 'next-env.d.ts', 'public/*'] }, ...next];

export default config;
