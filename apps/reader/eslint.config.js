const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*'] },
  {
    // The hexagon's core stays free of frameworks and outer layers.
    files: ['src/core/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['react', 'react-native', 'react-native-*', 'expo', 'expo-*', '@expo/*', '@kanso/*', '@/adapters/*', '@/ui/*', '@/app/*', '@/composition/*', '**/adapters/**', '**/ui/**', '**/app/**', '**/composition/**'],
        },
      ],
    },
  },
]);
