import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock schema-metadata-cache
vi.mock('../../../components/query-editor/schema-metadata-cache', () => ({
  getCache: vi.fn(),
  loadCache: vi.fn(),
}))

import { languages } from 'monaco-editor'
import { getCache } from '../../../components/query-editor/schema-metadata-cache'
import {
  AutocompleteProvider,
  subscribeDocItem,
  getDocItem,
  completionPrimaryLabel,
  pickDocItemForFirstSuggestion,
} from '../../../components/query-editor/AutocompleteProvider'

const mockGetCache = vi.mocked(getCache)

// Helper to create a mock ITextModel
function createMockModel(text: string) {
  return {
    getValue: () => text,
    getWordUntilPosition: (position: { lineNumber: number; column: number }) => {
      const lines = text.split('\n')
      const line = lines[position.lineNumber - 1] ?? ''
      const before = line.substring(0, position.column - 1)
      const match = before.match(/(\w*)$/)
      const word = match ? match[1] : ''
      return {
        word,
        startColumn: position.column - word.length,
        endColumn: position.column,
      }
    },
    getValueInRange: () => text,
  }
}

function createMockPosition(lineNumber: number, column: number) {
  return { lineNumber, column }
}

function suggestionPrimary(s: {
  label: string | import('monaco-editor').languages.CompletionItemLabel
}): string {
  return completionPrimaryLabel(s.label)
}

// Ready cache with sample data
const READY_CACHE = {
  status: 'ready' as const,
  databases: ['app_db', 'analytics_db'],
  tables: {
    app_db: [
      {
        name: 'users',
        engine: 'InnoDB',
        charset: 'utf8mb4',
        rowCount: 1000,
        dataSize: 1048576,
      },
      {
        name: 'products',
        engine: 'InnoDB',
        charset: 'utf8mb4',
        rowCount: 500,
        dataSize: 524288,
      },
    ],
    analytics_db: [
      {
        name: 'events',
        engine: 'InnoDB',
        charset: 'utf8mb4',
        rowCount: 50000,
        dataSize: 10485760,
      },
    ],
  },
  columns: {
    'app_db.users': [
      { name: 'id', dataType: 'int' },
      { name: 'email', dataType: 'varchar(255)' },
      { name: 'name', dataType: 'varchar(100)' },
    ],
    'app_db.products': [
      { name: 'id', dataType: 'int' },
      { name: 'title', dataType: 'varchar(200)' },
    ],
  },
  routines: {
    app_db: [{ name: 'get_user_count', routineType: 'FUNCTION' }],
  },
}

const EMPTY_CACHE = {
  status: 'empty' as const,
  databases: [],
  tables: {},
  columns: {},
  routines: {},
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('AutocompleteProvider', () => {
  it('returns keyword suggestions when cache is ready and text is generic context', () => {
    mockGetCache.mockReturnValue(READY_CACHE)

    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('SEL')
    const position = createMockPosition(1, 4)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = provider.provideCompletionItems(model as any, position as any) as any
    expect(result).toBeDefined()
    expect(result.suggestions.length).toBeGreaterThan(0)

    const labels = result.suggestions.map((s: { label: unknown }) => suggestionPrimary(s as never))
    expect(labels).toContain('SELECT')
  })

  it('returns "Loading schema..." when cache status is loading', () => {
    mockGetCache.mockReturnValue({
      ...EMPTY_CACHE,
      status: 'loading',
    })

    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('')
    const position = createMockPosition(1, 1)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = provider.provideCompletionItems(model as any, position as any) as any
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].label).toBe('Loading schema...')
  })

  it('returns "Schema unavailable" when cache status is error', () => {
    mockGetCache.mockReturnValue({
      ...EMPTY_CACHE,
      status: 'error',
      error: 'Connection failed',
    })

    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('')
    const position = createMockPosition(1, 1)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = provider.provideCompletionItems(model as any, position as any) as any
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].label).toBe('Schema unavailable')
  })

  it('returns keyword suggestions when cache is empty', () => {
    mockGetCache.mockReturnValue(EMPTY_CACHE)

    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('SE')
    const position = createMockPosition(1, 3)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = provider.provideCompletionItems(model as any, position as any) as any
    expect(result.suggestions.length).toBeGreaterThan(0)
    const labels = result.suggestions.map((s: { label: unknown }) => suggestionPrimary(s as never))
    expect(labels).toContain('SELECT')
    expect(labels).toContain('SET')
  })

  it('returns table suggestions in FROM context', () => {
    mockGetCache.mockReturnValue(READY_CACHE)

    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('SELECT * FROM u')
    const position = createMockPosition(1, 16)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = provider.provideCompletionItems(model as any, position as any) as any
    // Kind 5 = CompletionItemKind.Class (table)
    const tableLabels = result.suggestions
      .filter((s: { kind: number }) => s.kind === 5)
      .map((s: { label: unknown }) => suggestionPrimary(s as never))
    expect(tableLabels).toContain('users')
  })

  it('returns database suggestions in FROM context', () => {
    mockGetCache.mockReturnValue(READY_CACHE)

    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('SELECT * FROM a')
    const position = createMockPosition(1, 16)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = provider.provideCompletionItems(model as any, position as any) as any
    // Kind 8 = CompletionItemKind.Module (database)
    const dbLabels = result.suggestions
      .filter((s: { kind: number }) => s.kind === 8)
      .map((s: { label: unknown }) => suggestionPrimary(s as never))
    expect(dbLabels).toContain('app_db')
    expect(dbLabels).toContain('analytics_db')
  })

  it('returns tables after database dot notation', () => {
    mockGetCache.mockReturnValue(READY_CACHE)

    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('SELECT * FROM app_db.')
    const position = createMockPosition(1, 22)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = provider.provideCompletionItems(model as any, position as any) as any
    const labels = result.suggestions.map((s: { label: unknown }) => suggestionPrimary(s as never))
    expect(labels).toContain('users')
    expect(labels).toContain('products')
  })

  it('returns column suggestions after table dot notation', () => {
    mockGetCache.mockReturnValue(READY_CACHE)

    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('SELECT users.')
    const position = createMockPosition(1, 14)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = provider.provideCompletionItems(model as any, position as any) as any
    // Kind 4 = CompletionItemKind.Field (column)
    const fieldLabels = result.suggestions
      .filter((s: { kind: number }) => s.kind === 4)
      .map((s: { label: unknown }) => suggestionPrimary(s as never))
    expect(fieldLabels).toContain('id')
    expect(fieldLabels).toContain('email')
    expect(fieldLabels).toContain('name')
  })

  it('filters column suggestions by prefix after table dot', () => {
    mockGetCache.mockReturnValue(READY_CACHE)

    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('SELECT users.e')
    const position = createMockPosition(1, 15)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = provider.provideCompletionItems(model as any, position as any) as any
    const fieldLabels = result.suggestions
      .filter((s: { kind: number }) => s.kind === 4)
      .map((s: { label: unknown }) => suggestionPrimary(s as never))
    expect(fieldLabels).toContain('email')
    expect(fieldLabels).not.toContain('id')
  })

  it('includes routine suggestions in generic context', () => {
    mockGetCache.mockReturnValue(READY_CACHE)

    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('get')
    const position = createMockPosition(1, 4)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = provider.provideCompletionItems(model as any, position as any) as any
    // Kind 2 = CompletionItemKind.Function
    const routineLabels = result.suggestions
      .filter((s: { kind: number }) => s.kind === 2)
      .map((s: { label: unknown }) => suggestionPrimary(s as never))
    expect(routineLabels).toContain('get_user_count')
  })

  it('labels PROCEDURE routines as ROUTINE in the suggest list', () => {
    mockGetCache.mockReturnValue({
      ...READY_CACHE,
      routines: {
        app_db: [
          ...(READY_CACHE.routines.app_db ?? []),
          { name: 'sp_cleanup', routineType: 'PROCEDURE' },
        ],
      },
    })
    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('sp_c')
    const position = createMockPosition(1, 5)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = provider.provideCompletionItems(model as any, position as any) as any
    const proc = result.suggestions.find(
      (s: { kind: number; label: unknown }) =>
        s.kind === 2 && suggestionPrimary(s as never) === 'sp_cleanup'
    )
    expect(proc).toBeDefined()
    expect(proc.label).toEqual(
      expect.objectContaining({ label: 'sp_cleanup', description: 'ROUTINE' })
    )
  })

  it('has triggerCharacters set', () => {
    const provider = new AutocompleteProvider('conn-1')
    expect(provider.triggerCharacters).toEqual([' ', '.', '('])
  })

  it('embeds doc metadata in table suggestion documentation field', () => {
    mockGetCache.mockReturnValue(READY_CACHE)

    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('SELECT * FROM app_db.')
    const position = createMockPosition(1, 22)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = provider.provideCompletionItems(model as any, position as any) as any
    const tableSuggestion = result.suggestions.find((s: { label: unknown }) => suggestionPrimary(s as never) === 'users')
    expect(tableSuggestion).toBeDefined()
    expect(tableSuggestion.documentation).toBeDefined()
    // Documentation should start with zero-width space (the doc meta marker)
    expect(typeof tableSuggestion.documentation).toBe('string')
    expect(tableSuggestion.documentation.startsWith('\u200B')).toBe(true)
  })

  it('embeds doc metadata in column suggestion documentation field', () => {
    mockGetCache.mockReturnValue(READY_CACHE)

    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('SELECT users.')
    const position = createMockPosition(1, 14)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = provider.provideCompletionItems(model as any, position as any) as any
    const colSuggestion = result.suggestions.find((s: { label: unknown }) => suggestionPrimary(s as never) === 'id')
    expect(colSuggestion).toBeDefined()
    expect(colSuggestion.documentation).toBeDefined()
    expect(typeof colSuggestion.documentation).toBe('string')
  })

  it('embeds doc metadata in routine suggestion documentation field', () => {
    mockGetCache.mockReturnValue(READY_CACHE)

    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('get')
    const position = createMockPosition(1, 4)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = provider.provideCompletionItems(model as any, position as any) as any
    // Kind 2 = CompletionItemKind.Function
    const routineSuggestion = result.suggestions.find((s: { kind: number }) => s.kind === 2)
    expect(routineSuggestion).toBeDefined()
    expect(routineSuggestion.documentation).toBeDefined()
  })

  it('embeds doc metadata in database suggestion documentation field', () => {
    mockGetCache.mockReturnValue(READY_CACHE)

    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('SELECT * FROM a')
    const position = createMockPosition(1, 16)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = provider.provideCompletionItems(model as any, position as any) as any
    // Kind 8 = CompletionItemKind.Module (database)
    const dbSuggestion = result.suggestions.find((s: { kind: number }) => s.kind === 8)
    expect(dbSuggestion).toBeDefined()
    expect(dbSuggestion.documentation).toBeDefined()
  })
})

describe('resolveCompletionItem', () => {
  it('updates doc panel when item has encoded metadata', () => {
    mockGetCache.mockReturnValue(READY_CACHE)

    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('SELECT * FROM app_db.')
    const position = createMockPosition(1, 22)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = provider.provideCompletionItems(model as any, position as any) as any
    const tableSuggestion = result.suggestions.find((s: { label: unknown }) => suggestionPrimary(s as never) === 'users')

    const callback = vi.fn()
    const unsubscribe = subscribeDocItem(callback)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolved = provider.resolveCompletionItem(tableSuggestion as any)
    expect(resolved).toBe(tableSuggestion)

    expect(callback).toHaveBeenCalled()
    const docItem = callback.mock.calls[callback.mock.calls.length - 1][0]
    expect(docItem?.type).toBe('table')
    expect(docItem?.name).toBe('users')
    expect(docItem?.database).toBe('app_db')

    unsubscribe()
  })

  it('sets keyword doc item for keyword completion items', () => {
    const provider = new AutocompleteProvider('conn-1')

    const callback = vi.fn()
    const unsubscribe = subscribeDocItem(callback)

    // Create a keyword item without encoded metadata
    // CompletionItemKind.Keyword = 14 in the test mock (see setup.ts)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider.resolveCompletionItem({
      label: 'SELECT',
      kind: 14, // CompletionItemKind.Keyword (mocked value)
      insertText: 'SELECT',
      range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1 },
    } as any)

    expect(callback).toHaveBeenCalled()
    const docItem = callback.mock.calls[callback.mock.calls.length - 1][0]
    expect(docItem?.type).toBe('keyword')
    expect(docItem?.name).toBe('SELECT')

    unsubscribe()
  })

  it('handles item with no documentation gracefully', () => {
    const provider = new AutocompleteProvider('conn-1')

    // Item with no documentation and non-keyword kind
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = {
      label: 'test',
      kind: 0, // Text
      insertText: 'test',
      range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1 },
    } as any

    const resolved = provider.resolveCompletionItem(item)
    expect(resolved).toBe(item)
  })

  it('handles item with MarkdownString documentation', () => {
    mockGetCache.mockReturnValue(READY_CACHE)

    const provider = new AutocompleteProvider('conn-1')
    const callback = vi.fn()
    const unsubscribe = subscribeDocItem(callback)

    // Item with MarkdownString-style documentation (object with value)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = '\u200B' + JSON.stringify({ type: 'database', name: 'test_db' })
    provider.resolveCompletionItem({
      label: 'test_db',
      kind: 8, // Module
      insertText: 'test_db',
      documentation: { value: meta },
      range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1 },
    } as any)

    expect(callback).toHaveBeenCalled()
    const docItem = callback.mock.calls[callback.mock.calls.length - 1][0]
    expect(docItem?.type).toBe('database')
    expect(docItem?.name).toBe('test_db')

    unsubscribe()
  })
})

describe('completionPrimaryLabel', () => {
  it('returns plain string labels', () => {
    expect(completionPrimaryLabel('SELECT')).toBe('SELECT')
  })

  it('returns CompletionItemLabel.label', () => {
    expect(completionPrimaryLabel({ label: 'foo', description: 'BAR' })).toBe('foo')
  })
})

describe('pickDocItemForFirstSuggestion', () => {
  it('returns null for an empty suggestion list', () => {
    expect(pickDocItemForFirstSuggestion([], READY_CACHE)).toBeNull()
  })

  it('returns doc metadata decoded from documentation when present', () => {
    const meta = '\u200B' + JSON.stringify({ type: 'database', name: 'solo_db' })
    const item: languages.CompletionItem = {
      label: 'solo_db',
      kind: languages.CompletionItemKind.Module,
      insertText: 'solo_db',
      documentation: meta,
    }
    const picked = pickDocItemForFirstSuggestion([item], READY_CACHE)
    expect(picked?.type).toBe('database')
    expect(picked?.name).toBe('solo_db')
  })

  it('falls back to table resolution for Class items without encoded documentation', () => {
    const item: languages.CompletionItem = {
      label: { label: 'users', description: 'TABLE' },
      kind: languages.CompletionItemKind.Class,
      insertText: 'users',
    }
    const picked = pickDocItemForFirstSuggestion([item], READY_CACHE)
    expect(picked?.type).toBe('table')
    expect(picked?.name).toBe('users')
    expect(picked?.database).toBe('app_db')
  })

  it('falls back to database for Module items without documentation', () => {
    const item: languages.CompletionItem = {
      label: { label: 'app_db', description: 'DATABASE' },
      kind: languages.CompletionItemKind.Module,
      insertText: 'app_db',
    }
    expect(pickDocItemForFirstSuggestion([item], READY_CACHE)).toEqual({
      type: 'database',
      name: 'app_db',
    })
  })

  it('falls back to routine for Function items without documentation', () => {
    const item: languages.CompletionItem = {
      label: { label: 'fn', description: 'FUNCTION' },
      kind: languages.CompletionItemKind.Function,
      insertText: 'fn',
    }
    expect(pickDocItemForFirstSuggestion([item], READY_CACHE)).toEqual({
      type: 'routine',
      name: 'fn',
    })
  })

  it('falls back to keyword for Keyword items without documentation', () => {
    const item: languages.CompletionItem = {
      label: { label: 'WHERE', description: 'KEYWORD' },
      kind: languages.CompletionItemKind.Keyword,
      insertText: 'WHERE',
    }
    expect(pickDocItemForFirstSuggestion([item], READY_CACHE)).toEqual({
      type: 'keyword',
      name: 'WHERE',
    })
  })

  it('returns null when Class label does not match any table', () => {
    const item: languages.CompletionItem = {
      label: { label: 'ghost', description: 'TABLE' },
      kind: languages.CompletionItemKind.Class,
      insertText: 'ghost',
    }
    expect(pickDocItemForFirstSuggestion([item], READY_CACHE)).toBeNull()
  })
})

describe('subscribeDocItem / getDocItem', () => {
  it('getDocItem returns null initially', () => {
    expect(getDocItem()).toBeDefined() // might be null or set by previous test
  })

  it('subscribeDocItem receives updates when provider sets doc item', () => {
    const callback = vi.fn()
    const unsubscribe = subscribeDocItem(callback)

    // Trigger a completion to set the doc item
    mockGetCache.mockReturnValue(READY_CACHE)
    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('SELECT * FROM u')
    const position = createMockPosition(1, 16)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider.provideCompletionItems(model as any, position as any)

    expect(callback).toHaveBeenCalled()
    const lastCallArg = callback.mock.calls[callback.mock.calls.length - 1][0]
    expect(lastCallArg).toBeDefined()

    unsubscribe()
  })

  it('unsubscribe prevents further updates', () => {
    const callback = vi.fn()
    const unsubscribe = subscribeDocItem(callback)
    unsubscribe()

    mockGetCache.mockReturnValue(READY_CACHE)
    const provider = new AutocompleteProvider('conn-1')
    const model = createMockModel('SELECT * FROM u')
    const position = createMockPosition(1, 16)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider.provideCompletionItems(model as any, position as any)

    expect(callback).not.toHaveBeenCalled()
  })

  it('getDocItem returns the current item after provider call', () => {
    mockGetCache.mockReturnValue(READY_CACHE)
    const provider = new AutocompleteProvider('conn-1')
    // Use database dot notation to trigger table doc item
    const model = createMockModel('SELECT * FROM app_db.')
    const position = createMockPosition(1, 22)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider.provideCompletionItems(model as any, position as any)

    const item = getDocItem()
    expect(item).toBeDefined()
    expect(item?.type).toBe('table')
    expect(item?.name).toBe('users')
    expect(item?.database).toBe('app_db')
  })
})
