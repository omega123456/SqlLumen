import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'
import { clearMocks } from '@tauri-apps/api/mocks'

// ---------------------------------------------------------------------------
// Monaco Editor mocks for Vitest (jsdom doesn't support Monaco workers)
// ---------------------------------------------------------------------------

vi.mock('monaco-editor', () => ({
  editor: {
    create: vi.fn(() => ({
      getValue: vi.fn(() => ''),
      setValue: vi.fn(),
      getModel: vi.fn(() => null),
      onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeCursorPosition: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
      layout: vi.fn(),
      focus: vi.fn(),
      setPosition: vi.fn(),
      getPosition: vi.fn(() => ({ lineNumber: 1, column: 1 })),
    })),
    defineTheme: vi.fn(),
    setTheme: vi.fn(),
    createModel: vi.fn(() => ({
      dispose: vi.fn(),
      getValue: vi.fn(() => ''),
      setValue: vi.fn(),
    })),
    setModelLanguage: vi.fn(),
    EditorOption: {},
  },
  languages: {
    register: vi.fn(),
    setMonarchTokensProvider: vi.fn(),
    registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
    CompletionItemKind: {
      Keyword: 14,
      Class: 5,
      Field: 4,
      Module: 8,
      Function: 2,
      Text: 1,
      Snippet: 27,
    },
    CompletionItemInsertTextRule: {
      InsertAsSnippet: 4,
    },
  },
  Range: vi.fn(),
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { F5: 63 },
}))

// ---------------------------------------------------------------------------
// monaco-sql-languages mocks (contribution is a side-effect import)
// ---------------------------------------------------------------------------

vi.mock('monaco-sql-languages/esm/languages/mysql/mysql.contribution', () => ({}))

vi.mock('monaco-sql-languages', () => ({
  setupLanguageFeatures: vi.fn(),
  LanguageIdEnum: { MYSQL: 'mysql' },
  EntityContextType: {
    CATALOG: 'catalog',
    CATALOG_CREATE: 'catalogCreate',
    DATABASE: 'database',
    DATABASE_CREATE: 'databaseCreate',
    TABLE: 'table',
    TABLE_CREATE: 'tableCreate',
    VIEW: 'view',
    VIEW_CREATE: 'viewCreate',
    FUNCTION: 'function',
    FUNCTION_CREATE: 'functionCreate',
    PROCEDURE: 'procedure',
    PROCEDURE_CREATE: 'procedureCreate',
    COLUMN: 'column',
    COLUMN_CREATE: 'columnCreate',
  },
}))

vi.mock('@monaco-editor/react', async () => {
  const React = await import('react')
  return {
    default: (props: Record<string, unknown>) => {
      return React.createElement('textarea', {
        'data-testid': 'monaco-editor',
        value: (props.value as string) ?? '',
        onChange: (e: { target: { value: string } }) => {
          const fn = props.onChange as ((v: string | undefined) => void) | undefined
          fn?.(e.target.value)
        },
      })
    },
    useMonaco: () => null,
    loader: {
      init: () => Promise.resolve(),
      config: () => {},
    },
  }
})

// ---------------------------------------------------------------------------
// Polyfills for jsdom
// ---------------------------------------------------------------------------

// Polyfill ResizeObserver for jsdom (needed by react-resizable-panels)
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver
}

// Polyfill matchMedia for jsdom (needed by theme store)
if (typeof window.matchMedia === 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

// Polyfill HTMLDialogElement methods for jsdom (needed by ConnectionDialog)
if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    }
  }
}

afterEach(() => {
  clearMocks()
})
