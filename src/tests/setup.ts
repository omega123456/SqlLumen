import '@testing-library/jest-dom'
import 'jest-canvas-mock'
import { act, cleanup } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, vi } from 'vitest'

import { setupIpc } from './ipc-mock'

/** React 19 + Vitest: known stray act() warnings from long-lived async test-only mocks. */
const FILTERED_ACT_NOISE_PATTERNS = [
  /An update to RunningIndicator inside a test was not wrapped in act/i,
  /An update to ForwardRef\(CanvasBaseGridViewInner\) inside a test was not wrapped in act/i,
  /An update to ResultPanel inside a test was not wrapped in act/i,
]

function isFilteredActNoise(value: unknown): value is string {
  return (
    typeof value === 'string' && FILTERED_ACT_NOISE_PATTERNS.some((pattern) => pattern.test(value))
  )
}
const originalConsoleError = console.error
console.error = (...args: Parameters<typeof console.error>) => {
  if (args.some((a) => isFilteredActNoise(a))) {
    return
  }
  originalConsoleError.apply(console, args)
}

// Under v8 coverage, some act() warnings still reach stderr; filter the same lines as console.error above.
const originalStderrWrite = process.stderr.write.bind(process.stderr)
process.stderr.write = ((chunk: string | Uint8Array, encoding?: unknown, cb?: unknown) => {
  const text =
    typeof chunk === 'string'
      ? chunk
      : Buffer.isBuffer(chunk)
        ? chunk.toString('utf8')
        : new TextDecoder().decode(chunk)
  if (isFilteredActNoise(text)) {
    if (typeof encoding === 'function') {
      ;(encoding as () => void)()
    } else if (typeof cb === 'function') {
      ;(cb as (err?: Error | null) => void)()
    }
    return true
  }
  return originalStderrWrite(
    chunk as Buffer,
    encoding as BufferEncoding,
    cb as ((err?: Error | null) => void) | undefined
  )
}) as typeof process.stderr.write

// Register IPC mock hooks (beforeEach + afterEach) for all tests.
setupIpc()

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
    onDidCreateEditor: vi.fn(() => ({ dispose: vi.fn() })),
    registerCommand: vi.fn(),
  },
  languages: {
    register: vi.fn(),
    setMonarchTokensProvider: vi.fn(),
    registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerSignatureHelpProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerCodeLensProvider: vi.fn(() => ({ dispose: vi.fn() })),
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
  Emitter: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.event = vi.fn()
    this.fire = vi.fn()
    this.dispose = vi.fn()
  }),
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

// ---------------------------------------------------------------------------
// react-markdown + rehype/remark mocks (ESM-only packages)
// ---------------------------------------------------------------------------

vi.mock('react-markdown', async () => {
  const React = await import('react')
  return {
    default: ({
      children,
    }: {
      children: string
      remarkPlugins?: unknown[]
      rehypePlugins?: unknown[]
      components?: Record<string, unknown>
    }) => {
      return React.createElement('div', { 'data-testid': 'markdown' }, children)
    },
  }
})

vi.mock('remark-gfm', () => ({ default: () => {} }))
vi.mock('rehype-highlight', () => ({ default: () => {} }))

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
    DiffEditor: (props: Record<string, unknown>) => {
      // Call onMount with a mock diff editor if provided
      const onMount = props.onMount as ((editor: unknown) => void) | undefined
      const hostRef = React.useRef<HTMLDivElement | null>(null)
      type MockModel = {
        original: { getValue: () => string }
        modified: { getValue: () => string }
      } | null

      type ViewZoneSpec = {
        domNode: HTMLElement
      }
      type ViewZoneAccessor = {
        addZone: (zone: ViewZoneSpec) => string
        removeZone: (id: string) => void
        layoutZone: ReturnType<typeof vi.fn>
      }
      type ViewZoneCallback = (accessor: ViewZoneAccessor) => void

      const createViewZoneRunner = () => {
        const zoneDomById = new Map<string, HTMLElement>()
        return (cb: ViewZoneCallback) => {
          const accessor: ViewZoneAccessor = {
            addZone: (zone: ViewZoneSpec) => {
              const id = `mock-view-zone-${Math.random().toString(36).slice(2, 9)}`
              zoneDomById.set(id, zone.domNode)
              const host = hostRef.current
              if (host) {
                host.appendChild(zone.domNode)
              }
              return id
            },
            removeZone: (id: string) => {
              const node = zoneDomById.get(id)
              node?.remove()
              zoneDomById.delete(id)
            },
            layoutZone: vi.fn(),
          }
          cb(accessor)
        }
      }

      const runOriginalViewZones = createViewZoneRunner()
      const runModifiedViewZones = createViewZoneRunner()

      const mockOriginalEditor = {
        onDidScrollChange: vi.fn(() => ({ dispose: vi.fn() })),
        getTopForLineNumber: vi.fn((line: number) => line * 20),
        getScrollTop: vi.fn(() => 0),
        changeViewZones: vi.fn((cb: ViewZoneCallback) => {
          runOriginalViewZones(cb)
        }),
      }

      const mockModifiedEditor = {
        onDidScrollChange: vi.fn(() => ({ dispose: vi.fn() })),
        getTopForLineNumber: vi.fn((line: number) => line * 20),
        getScrollTop: vi.fn(() => 0),
        addContentWidget: vi.fn((widget: { getDomNode: () => HTMLElement }) => {
          const node = widget.getDomNode()
          const host = hostRef.current
          if (host) {
            host.appendChild(node)
          }
        }),
        removeContentWidget: vi.fn((widget: { getDomNode: () => HTMLElement }) => {
          widget.getDomNode().remove()
        }),
        layoutContentWidget: vi.fn(),
        changeViewZones: vi.fn((cb: ViewZoneCallback) => {
          runModifiedViewZones(cb)
        }),
      }

      type EditorRef = {
        _model: MockModel
        setModel: (model: MockModel) => void
        onDidUpdateDiff: (cb: () => void) => { dispose: () => void }
        getLineChanges: () => null
        getOriginalEditor: () => typeof mockOriginalEditor
        getModifiedEditor: () => typeof mockModifiedEditor
      }

      const editorRef = React.useRef<EditorRef | null>(null)

      if (editorRef.current === null) {
        const ref: EditorRef = {
          _model: null,
          setModel(model: MockModel) {
            ref._model = model
          },
          onDidUpdateDiff: vi.fn(() => ({ dispose: vi.fn() })),
          getLineChanges: vi.fn(() => null),
          getOriginalEditor: vi.fn(() => mockOriginalEditor),
          getModifiedEditor: vi.fn(() => mockModifiedEditor),
        }

        editorRef.current = ref
      }

      useEffect(() => {
        if (onMount && editorRef.current) {
          onMount(editorRef.current)
        }
      }, [onMount])

      return React.createElement('div', {
        ref: (el: HTMLDivElement | null) => {
          hostRef.current = el
        },
        'data-testid': 'mock-diff-editor',
        'data-original': (props.original as string) ?? '',
        'data-modified': (props.modified as string) ?? '',
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

// Polyfill Element.scrollIntoView for jsdom (needed by auto-scroll in AI panel)
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {}
}

// Polyfill navigator.clipboard for jsdom (needed by copy-to-clipboard flows)
if (typeof navigator.clipboard === 'undefined') {
  Object.defineProperty(navigator, 'clipboard', {
    writable: true,
    configurable: true,
    value: {
      writeText: vi.fn(() => Promise.resolve()),
      readText: vi.fn(() => Promise.resolve('')),
    },
  })
}

afterEach(() => {
  act(() => {
    cleanup()
  })
})
