const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  { ignores: ['node_modules/*', '*.config.*'] },
  ...tseslint.configs.recommended,
  {
    // The hexagon's core imports nothing outside itself and touches no platform globals.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ regex: '^(?!\\.)', message: 'core imports nothing outside itself' }] }],
      'no-restricted-globals': ['error', 'fetch', 'window', 'document', 'localStorage', 'indexedDB', 'crypto', 'navigator'],
    },
  },
);
