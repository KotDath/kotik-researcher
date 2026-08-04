import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out', 'dist', 'node_modules', '.opencode'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' }
    }
  },
  // tracked диагностический скрипт st2.mjs — ровно те глобалы, которые он
  // использует (process/document/console/setTimeout). Файл не меняется.
  {
    files: ['st2.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly'
      }
    }
  }
)
