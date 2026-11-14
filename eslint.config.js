import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { localRulesPlugin } from './scripts/eslint-named-conditions.mjs'

const PRODUCTION_SOURCE_FILES = ['src/**/*.{ts,tsx}']
const TEST_SOURCE_FILES = ['src/tests/**']
const CONSOLE_SINK_FILES = ['src/lib/app-log-commands.ts']

const MINIMUM_IDENTIFIER_LENGTH = 2
const NUMBERS_ALLOWED_INLINE = [0, 1, -1]
const MAXIMUM_COMPLEXITY = 10
const MAXIMUM_PARAMETERS = 3
const MAXIMUM_BLOCK_DEPTH = 2
const MAXIMUM_FUNCTION_LINES = 60
const MAXIMUM_FILE_LINES = 400
const ELSE_MESSAGE = 'Use guard clauses, a lookup table, or a named function instead of else'

const CONFORMANCE_RULE_SCOPES = [
  {
    files: PRODUCTION_SOURCE_FILES,
    rules: { 'no-console': 'error' },
  },
  {
    files: PRODUCTION_SOURCE_FILES,
    rules: {
      'id-length': [
        'error',
        { min: MINIMUM_IDENTIFIER_LENGTH, properties: 'never', exceptions: ['_'] },
      ],
    },
  },
  {
    files: PRODUCTION_SOURCE_FILES,
    rules: {
      'no-magic-numbers': 'off',
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: NUMBERS_ALLOWED_INLINE,
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreClassFieldInitialValues: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
        },
      ],
    },
  },
  {
    files: PRODUCTION_SOURCE_FILES,
    rules: { 'object-shorthand': ['error', 'consistent'] },
  },
  {
    files: PRODUCTION_SOURCE_FILES,
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'IfStatement[alternate]', message: ELSE_MESSAGE },
      ],
    },
  },
  {
    files: PRODUCTION_SOURCE_FILES,
    rules: { 'no-nested-ternary': 'error' },
  },
  {
    files: PRODUCTION_SOURCE_FILES,
    rules: { complexity: ['error', MAXIMUM_COMPLEXITY] },
  },
  {
    files: PRODUCTION_SOURCE_FILES,
    rules: { 'local/named-conditions': 'error' },
  },
  {
    files: PRODUCTION_SOURCE_FILES,
    rules: { 'max-params': ['error', MAXIMUM_PARAMETERS] },
  },
  {
    files: PRODUCTION_SOURCE_FILES,
    rules: { '@typescript-eslint/no-unnecessary-type-assertion': 'error' },
  },
  {
    files: PRODUCTION_SOURCE_FILES,
    rules: { '@typescript-eslint/no-non-null-assertion': 'error' },
  },
  {
    files: PRODUCTION_SOURCE_FILES,
    rules: { 'max-depth': ['error', MAXIMUM_BLOCK_DEPTH] },
  },
  {
    files: PRODUCTION_SOURCE_FILES,
    rules: {
      'max-lines-per-function': [
        'error',
        { max: MAXIMUM_FUNCTION_LINES, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: PRODUCTION_SOURCE_FILES,
    rules: {
      'max-lines': ['error', { max: MAXIMUM_FILE_LINES, skipBlankLines: true, skipComments: true }],
    },
  },
]

function hasScopedFiles(ruleScope) {
  return ruleScope.files.length > 0
}

function productionRuleBlock(ruleScope) {
  return { files: ruleScope.files, ignores: TEST_SOURCE_FILES, rules: ruleScope.rules }
}

const scopedConformanceBlocks =
  CONFORMANCE_RULE_SCOPES.filter(hasScopedFiles).map(productionRuleBlock)

export default defineConfig(
  { ignores: ['dist', 'src-tauri'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          allowExportNames: [
            'useRegisterAiDiffHandler',
            'useAiDiffTrigger',
            'useFkLookup',
            'FkLookupContext',
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: PRODUCTION_SOURCE_FILES,
    ignores: TEST_SOURCE_FILES,
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      local: localRulesPlugin,
    },
  },
  ...scopedConformanceBlocks,
  {
    files: CONSOLE_SINK_FILES,
    rules: { 'no-console': 'off' },
  }
)
