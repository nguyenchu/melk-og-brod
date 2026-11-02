// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // .claude/ inneholder worktrees med egne kopier av koden.
    ignores: ['dist/*', '.claude/**'],
  },
]);
