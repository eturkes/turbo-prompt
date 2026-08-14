import { selfContainedPlugin } from '@in-progress/protocol/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  base: './',
  plugins: [react(), selfContainedPlugin({ name: 'turbo-prompt-self-contained-plugin' })],
  build: {
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    rollupOptions: { output: { codeSplitting: false } },
  },
  test: {
    environment: 'node',
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
  lint: {
    ignorePatterns: ['dist/**', 'vendor/**'],
    plugins: ['eslint', 'typescript', 'react', 'unicorn', 'oxc', 'import', 'vitest', 'jsx-a11y'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      'jsx-a11y/prefer-tag-over-role': 'off',
    },
    overrides: [
      {
        files: ['src/components/HistoryDialog.tsx', 'src/components/ProjectDialog.tsx'],
        rules: {
          'jsx-a11y/click-events-have-key-events': 'off',
          'jsx-a11y/no-noninteractive-element-interactions': 'off',
        },
      },
      {
        files: ['src/components/SuggestionMenu.tsx'],
        rules: {
          'jsx-a11y/click-events-have-key-events': 'off',
          'jsx-a11y/interactive-supports-focus': 'off',
        },
      },
    ],
  },
  fmt: {
    ignorePatterns: ['dist/**', 'vendor/**'],
    semi: false,
    singleQuote: true,
    sortPackageJson: false,
  },
})
