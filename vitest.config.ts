import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // .claude/ inneholder worktrees med egne kopier av testene.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
