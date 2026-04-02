import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { languages } from 'monaco-editor'

// Mock schema-metadata-cache before importing the module under test
vi.mock('../../../components/query-editor/schema-metadata-cache', () => ({
  getCache: vi.fn(),
  getPendingLoad: vi.fn(() => null),
  loadCache: vi.fn(() => Promise.resolve()),
  _clearAllCaches: vi.fn(),
}))

// Mock mysql-language-setup (side-effect import used by MonacoEditorWrapper, not by completion-service)
vi.mock('../../../components/query-editor/mysql-language-setup', () => ({}))

vi.mock('../../../stores/schema-store', () => ({
  useSchemaStore: {
    getState: vi.fn(() => ({ connectionStates: {} })),
  },
  parseNodeId: vi.fn((nodeId: string) => {
    const [type, database, name] = nodeId.split(':')
    return {
      type,
      database: database ?? '',
      name: name ?? '',
    }
  }),
}))

// Mock connection store so completionService can read activeDatabase
const mockConnectionState = {
  activeConnections: {} as Record<string, unknown>,
}
vi.mock('../../../stores/connection-store', () => ({
  useConnectionStore: {
    getState: () => mockConnectionState,
  },
}))

import {
  getCache,
  getPendingLoad,
  loadCache,
} from '../../../components/query-editor/schema-metadata-cache'
import {
  completionService,
  registerModelConnection,
  unregisterModelConnection,
  resetModelConnections,
} from '../../../components/query-editor/completion-service'
import { EntityContextType } from 'monaco-sql-languages'
import { parseNodeId, useSchemaStore } from '../../../stores/schema-store'

const mockGetCache = vi.mocked(getCache)
const mockGetPendingLoad = vi.mocked(getPendingLoad)
const mockLoadCache = vi.mocked(loadCache)
const mockUseSchemaStoreGetState = vi.mocked(useSchemaStore.getState)
const mockParseNodeId = vi.mocked(parseNodeId)

// ---------------------------------------------------------------------------
// Helpers for working with completion items
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyItem = any

function getLabel(item: AnyItem): string {
  if (typeof item.label === 'string') return item.label
  if (item.label && typeof item.label === 'object' && 'label' in item.label) {
    return item.label.label
  }
  return String(item.label)
}

function unwrapResult(items: AnyItem): AnyItem[] {
  return Array.isArray(items) ? items : items.suggestions
}

// ---------------------------------------------------------------------------
// Mock model / position / context builders
// ---------------------------------------------------------------------------

function createMockModel(text: string, uri = 'inmemory://model/1') {
  const lines = text.split('\n')
  return {
    uri: { toString: () => uri },
    getValue: () => text,
    getLineContent: (lineNumber: number) => lines[lineNumber - 1] ?? '',
    getOffsetAt: (position: { lineNumber: number; column: number }) => {
      let offset = 0
      for (let i = 0; i < position.lineNumber - 1; i++) {
        offset += lines[i].length + 1 // +1 for newline
      }
      offset += position.column - 1
      return offset
    },
    getWordUntilPosition: (position: { lineNumber: number; column: number }) => {
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
  }
}

function pos(lineNumber: number, column: number) {
  return { lineNumber, column }
}

function ctx(triggerCharacter?: string) {
  return {
    triggerKind: triggerCharacter ? 1 : 0,
    triggerCharacter,
  }
}

function buildSuggestions(
  overrides?: Partial<{
    syntax: Array<{ syntaxContextType: string; wordRanges: unknown[] }>
    keywords: string[]
  }>
) {
  return {
    syntax: [],
    keywords: [],
    ...overrides,
  }
}

function buildEntity(type: string, text: string, isContainCaret = false) {
  return {
    entityContextType: type,
    text,
    position: {
      line: 1,
      startIndex: 0,
      endIndex: text.length,
      startColumn: 1,
      endColumn: text.length + 1,
    },
    belongStmt: {
      stmtContextType: 'selectStmt',
      position: {
        startIndex: 0,
        endIndex: 100,
        startLine: 1,
        endLine: 1,
        startColumn: 1,
        endColumn: 100,
      },
      rootStmt: null,
      parentStmt: null,
      isContainCaret,
    },
    _comment: null,
  }
}

function buildEntityWithAlias(
  type: string,
  text: string,
  aliasText: string,
  isContainCaret = false
) {
  return {
    ...buildEntity(type, text, isContainCaret),
    _alias: {
      text: aliasText,
      line: 1,
      startIndex: 0,
      endIndex: aliasText.length,
      startColumn: text.length + 2,
      endColumn: text.length + 2 + aliasText.length,
    },
  }
}

// Shorthand to call completionService with common mocking patterns

async function callService(
  text: string,
  position: { lineNumber: number; column: number },
  suggestions: AnyItem | null,
  entities: AnyItem | null = null,
  triggerChar?: string,
  snippets?: AnyItem,
  uri = 'inmemory://model/1'
): Promise<AnyItem[]> {
  const model = createMockModel(text, uri)
  const result = await completionService(
    model as AnyItem,
    position as AnyItem,
    ctx(triggerChar) as AnyItem,
    suggestions,
    entities,
    snippets
  )
  return unwrapResult(result)
}

// ---------------------------------------------------------------------------
// Cache fixtures
// ---------------------------------------------------------------------------

const READY_CACHE = {
  status: 'ready' as const,
  databases: ['app_db', 'analytics_db'],
  tables: {
    app_db: [
      { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 1000, dataSize: 1048576 },
      { name: 'products', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 500, dataSize: 524288 },
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
    'analytics_db.events': [
      { name: 'event_id', dataType: 'int' },
      { name: 'event_type', dataType: 'varchar(50)' },
    ],
  },
  routines: {
    app_db: [
      { name: 'get_user_count', routineType: 'FUNCTION' },
      { name: 'sp_cleanup', routineType: 'PROCEDURE' },
    ],
  },
}

const EMPTY_CACHE = {
  status: 'empty' as const,
  databases: [],
  tables: {},
  columns: {},
  routines: {},
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  // Reset connection state to empty for each test
  mockConnectionState.activeConnections = {}
  mockUseSchemaStoreGetState.mockReturnValue({ connectionStates: {} } as never)
  mockParseNodeId.mockImplementation((nodeId: string) => {
    const [type, database, name] = nodeId.split(':')
    return {
      type: type as never,
      database: database ?? '',
      name: name ?? '',
    }
  })
})

afterEach(() => {
  resetModelConnections()
})

describe('Model-URI registry', () => {
  it('registers and looks up a model-connection mapping', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService('SEL', pos(1, 4), buildSuggestions({ keywords: ['SELECT'] }))
    expect(items.map(getLabel)).toContain('SELECT')
  })

  it('unregisters a mapping so subsequent lookups return undefined', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    unregisterModelConnection('inmemory://model/1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SEL',
      pos(1, 4),
      buildSuggestions({ keywords: ['SELECT', 'SET'] })
    )
    const labels = items.map(getLabel)
    expect(labels).toContain('SELECT')
    expect(labels).toContain('SET')
    // No schema items since no connectionId
    const tableItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Class)
    expect(tableItems).toHaveLength(0)
  })

  it('resetModelConnections clears all entries', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    registerModelConnection('inmemory://model/2', 'conn-2')
    resetModelConnections()

    mockGetCache.mockReturnValue(READY_CACHE)
    const items = await callService('SE', pos(1, 3), buildSuggestions({ keywords: ['SELECT'] }))
    // No schema items since no connectionId after reset
    const moduleItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Module)
    expect(moduleItems).toHaveLength(0)
  })
})

describe('completionService — no connectionId', () => {
  it('returns only keyword suggestions when no model-connection mapping exists', async () => {
    const items = await callService(
      'SEL',
      pos(1, 4),
      buildSuggestions({ keywords: ['SELECT', 'SET'] })
    )
    expect(items).toHaveLength(2)
    expect(items.every((i: AnyItem) => i.kind === languages.CompletionItemKind.Keyword)).toBe(true)
    expect(items.map(getLabel)).toEqual(['SELECT', 'SET'])
  })
})

describe('completionService — parse-failure fallback', () => {
  it('returns schema dump + basic keywords when suggestions is null', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService('SELECT * FRM', pos(1, 13), null)
    const labels = items.map(getLabel)

    // Basic SQL keywords
    expect(labels).toContain('SELECT')
    expect(labels).toContain('FROM')
    expect(labels).toContain('WHERE')

    // Databases
    expect(labels).toContain('app_db')
    expect(labels).toContain('analytics_db')

    // Tables
    expect(labels).toContain('users')
    expect(labels).toContain('products')
    expect(labels).toContain('events')

    // Columns
    expect(labels).toContain('id')
    expect(labels).toContain('email')

    // Routines
    expect(labels).toContain('get_user_count')
    expect(labels).toContain('sp_cleanup')
  })

  it('returns only basic keywords when suggestions is null and no connectionId', async () => {
    const items = await callService('broken sql', pos(1, 11), null)
    const labels = items.map(getLabel)

    expect(labels).toContain('SELECT')
    expect(labels).toContain('FROM')
    // No schema items
    const classItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Class)
    expect(classItems).toHaveLength(0)
  })
})

describe('completionService — loading cache', () => {
  it('returns loading placeholder when cache status is loading', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue({ ...EMPTY_CACHE, status: 'loading' })

    const items = await callService('', pos(1, 1), buildSuggestions({ keywords: ['SELECT'] }))
    expect(items).toHaveLength(1)
    expect(getLabel(items[0])).toBe('Loading schema...')
    expect(items[0].kind).toBe(languages.CompletionItemKind.Text)
    expect(items[0].insertText).toBe('')
  })
})

describe('completionService — error cache', () => {
  it('returns error placeholder when cache status is error', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue({
      ...EMPTY_CACHE,
      status: 'error',
      error: 'Connection failed',
    })

    const items = await callService('', pos(1, 1), buildSuggestions({ keywords: ['SELECT'] }))
    expect(items).toHaveLength(1)
    expect(getLabel(items[0])).toBe('Schema unavailable')
    expect(items[0].kind).toBe(languages.CompletionItemKind.Text)
  })
})

describe('completionService — keyword suggestions', () => {
  it('maps suggestions.keywords to CompletionItem with kind Keyword', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SE',
      pos(1, 3),
      buildSuggestions({ keywords: ['SELECT', 'SET', 'SHOW'] })
    )
    const kwItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Keyword)
    const labels = kwItems.map(getLabel)
    expect(labels).toContain('SELECT')
    expect(labels).toContain('SET')
    expect(labels).toContain('SHOW')
  })
})

describe('completionService — database suggestions', () => {
  it('returns databases when EntityContextType.DATABASE is in suggestions.syntax', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'USE ',
      pos(1, 5),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.DATABASE, wordRanges: [] }],
        keywords: [],
      })
    )
    const dbItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Module)
    expect(dbItems.map(getLabel)).toContain('app_db')
    expect(dbItems.map(getLabel)).toContain('analytics_db')
  })
})

describe('completionService — table suggestions', () => {
  it('returns databases when no database is selected and EntityContextType.TABLE is in syntax', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SELECT * FROM ',
      pos(1, 15),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.TABLE, wordRanges: [] }],
        keywords: [],
      })
    )
    const labels = items.map(getLabel)
    expect(labels).toContain('app_db')
    expect(labels).toContain('analytics_db')
    expect(labels).not.toContain('users')
    expect(labels).not.toContain('products')
    expect(labels).not.toContain('events')
  })

  it('ranks databases above keywords after FROM when no database is selected', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SELECT * FROM ',
      pos(1, 15),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.TABLE, wordRanges: [] }],
        keywords: ['FROM', 'WHERE', 'SELECT'],
      })
    )

    const dbItems = items.filter(
      (item: AnyItem) =>
        item.kind === languages.CompletionItemKind.Module &&
        ['app_db', 'analytics_db'].includes(getLabel(item))
    )
    const keywordItems = items.filter(
      (item: AnyItem) => item.kind === languages.CompletionItemKind.Keyword
    )

    expect(dbItems.length).toBeGreaterThan(0)
    expect(keywordItems.length).toBeGreaterThan(0)

    for (const item of dbItems) {
      expect(item.sortText).toMatch(/^0_/)
    }

    for (const item of keywordItems) {
      expect(item.sortText).toMatch(/^2_/)
    }
  })

  it('returns tables only for the selected database when EntityContextType.TABLE is in syntax', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockUseSchemaStoreGetState.mockReturnValue({
      connectionStates: {
        'conn-1': {
          selectedNodeId: 'database:app_db:app_db',
        },
      },
    } as never)

    const items = await callService(
      'SELECT * FROM ',
      pos(1, 15),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.TABLE, wordRanges: [] }],
        keywords: [],
      })
    )

    const tableItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Class)
    const labels = tableItems.map(getLabel)
    expect(labels).toContain('users')
    expect(labels).toContain('products')
    expect(labels).not.toContain('events')
  })

  it('returns database names and selected-database tables before keywords', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockUseSchemaStoreGetState.mockReturnValue({
      connectionStates: {
        'conn-1': {
          selectedNodeId: 'database:analytics_db:analytics_db',
        },
      },
    } as never)

    const items = await callService(
      'SELECT * FROM ',
      pos(1, 15),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.TABLE, wordRanges: [] }],
        keywords: ['LATERAL', 'SELECT'],
      })
    )

    const labels = items.map(getLabel)
    expect(labels).toContain('analytics_db')
    expect(labels).toContain('app_db')
    expect(labels).toContain('events')

    const firstSchema = items.find(
      (item: AnyItem) =>
        [languages.CompletionItemKind.Module, languages.CompletionItemKind.Class].includes(
          item.kind
        ) && ['analytics_db', 'app_db', 'events'].includes(getLabel(item))
    )
    const firstKeyword = items.find(
      (item: AnyItem) => item.kind === languages.CompletionItemKind.Keyword
    )

    expect(firstSchema?.sortText).toMatch(/^0_/)
    expect(firstKeyword?.sortText).toMatch(/^2_/)
  })

  it('ignores defaultDatabase when no tree node is selected', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: 'app_db' },
        sessionDatabase: 'app_db',
        status: 'connected',
      },
    }

    const items = await callService(
      'SELECT * FROM ',
      pos(1, 15),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.TABLE, wordRanges: [] }],
        keywords: [],
      })
    )

    const labels = items.map(getLabel)
    expect(labels).toContain('app_db')
    expect(labels).toContain('analytics_db')
    expect(labels).not.toContain('users')
    expect(labels).not.toContain('products')
    expect(labels).not.toContain('events')
  })

  it('uses the selected node database even when the selected node is not a database root', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockUseSchemaStoreGetState.mockReturnValue({
      connectionStates: {
        'conn-1': {
          selectedNodeId: 'table:analytics_db:events',
        },
      },
    } as never)

    const items = await callService(
      'SELECT * FROM ',
      pos(1, 15),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.TABLE, wordRanges: [] }],
        keywords: [],
      })
    )

    const labels = items.map(getLabel)
    expect(labels).toContain('analytics_db')
    expect(labels).toContain('app_db')
    expect(labels).toContain('events')
  })
})

describe('completionService — column suggestions scoped', () => {
  it('scopes columns to tables in the caret statement when entities are available', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const entities = [buildEntity(EntityContextType.TABLE, 'users', true)]
    const items = await callService(
      'SELECT  FROM users',
      pos(1, 8),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.COLUMN, wordRanges: [] }],
        keywords: [],
      }),
      entities
    )
    const colItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Field)
    const labels = colItems.map(getLabel)
    // Should include columns from 'users' table only
    expect(labels).toContain('id')
    expect(labels).toContain('email')
    expect(labels).toContain('name')
    // Should NOT include columns from 'products' or 'events'
    expect(labels).not.toContain('title')
    expect(labels).not.toContain('event_id')
  })

  it('scopes columns for qualified table entity (analytics_db.events)', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    // Entity text is "analytics_db.events" — a qualified table reference
    const entities = [buildEntity(EntityContextType.TABLE, 'analytics_db.events', true)]
    const items = await callService(
      'SELECT  FROM analytics_db.events WHERE id =',
      pos(1, 8),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.COLUMN, wordRanges: [] }],
        keywords: [],
      }),
      entities
    )
    const colItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Field)
    const labels = colItems.map(getLabel)
    // Should include columns from analytics_db.events
    expect(labels).toContain('event_id')
    expect(labels).toContain('event_type')
    // Should NOT include columns from app_db tables
    expect(labels).not.toContain('id')
    expect(labels).not.toContain('email')
    expect(labels).not.toContain('title')
  })
})

describe('completionService — column suggestions broad fallback', () => {
  it('returns all columns when no entities with isContainCaret exist', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SELECT ',
      pos(1, 8),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.COLUMN, wordRanges: [] }],
        keywords: [],
      }),
      []
    )
    const colItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Field)
    const labels = colItems.map(getLabel)
    // Should include columns from all tables
    expect(labels).toContain('id')
    expect(labels).toContain('email')
    expect(labels).toContain('title')
    expect(labels).toContain('event_id')
  })

  it('scopes broad SELECT-list column suggestions to the active database', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: 'app_db' },
        sessionDatabase: 'app_db',
        status: 'connected',
      },
    }

    const items = await callService(
      'SELECT ',
      pos(1, 8),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.COLUMN, wordRanges: [] }],
        keywords: [],
      }),
      null
    )

    const colItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Field)
    const labels = colItems.map(getLabel)

    expect(labels).toContain('id')
    expect(labels).toContain('email')
    expect(labels).toContain('name')
    expect(labels).toContain('title')
    expect(labels).not.toContain('event_id')
    expect(labels).not.toContain('event_type')
  })

  it('falls back to the selected schema database when no active database is set', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: null },
        sessionDatabase: null,
        status: 'connected',
      },
    }
    mockUseSchemaStoreGetState.mockReturnValue({
      connectionStates: {
        'conn-1': {
          selectedNodeId: 'database:analytics_db:analytics_db',
        },
      },
    } as never)

    const items = await callService(
      'SELECT ',
      pos(1, 8),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.COLUMN, wordRanges: [] }],
        keywords: [],
      }),
      null
    )

    const colItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Field)
    const labels = colItems.map(getLabel)

    expect(labels).toContain('event_id')
    expect(labels).toContain('event_type')
    expect(labels).not.toContain('email')
    expect(labels).not.toContain('title')
  })

  it('scopes SELECT-list Ctrl+Space suggestions to tables referenced later in the same statement', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: 'app_db' },
        sessionDatabase: 'app_db',
        status: 'connected',
      },
    }

    const items = await callService(
      'SELECT  FROM users u',
      pos(1, 8),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.COLUMN, wordRanges: [] }],
        keywords: [],
      }),
      null
    )

    const colItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Field)
    const labels = colItems.map(getLabel)

    expect(labels).toContain('id')
    expect(labels).toContain('email')
    expect(labels).toContain('name')
    expect(labels).not.toContain('title')
    expect(labels).not.toContain('event_id')
  })
})

describe('completionService — function suggestions', () => {
  it('returns functions when EntityContextType.FUNCTION is in syntax', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SELECT ',
      pos(1, 8),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.FUNCTION, wordRanges: [] }],
        keywords: [],
      })
    )
    const fnItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Function)
    expect(fnItems.map(getLabel)).toContain('get_user_count')
    // PROCEDURE should NOT be included in FUNCTION context
    expect(fnItems.map(getLabel)).not.toContain('sp_cleanup')
  })
})

describe('completionService — procedure suggestions', () => {
  it('returns procedures when EntityContextType.PROCEDURE is in syntax', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'CALL ',
      pos(1, 6),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.PROCEDURE, wordRanges: [] }],
        keywords: [],
      })
    )
    // Procedures use Module kind per the implementation
    const procItems = items.filter(
      (i: AnyItem) => i.kind === languages.CompletionItemKind.Module && getLabel(i) === 'sp_cleanup'
    )
    expect(procItems).toHaveLength(1)
    // FUNCTION should NOT be included
    const fnItems = items.filter(
      (i: AnyItem) =>
        i.kind === languages.CompletionItemKind.Function && getLabel(i) === 'get_user_count'
    )
    expect(fnItems).toHaveLength(0)
  })
})

describe('completionService — dot notation (db.)', () => {
  it('returns tables for a database when trigger is dot after db name', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SELECT * FROM app_db.',
      pos(1, 22),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.TABLE, wordRanges: [] }],
        keywords: [],
      }),
      null,
      '.'
    )
    const labels = items.map(getLabel)
    expect(labels).toContain('users')
    expect(labels).toContain('products')
    // Should NOT include tables from other databases
    expect(labels).not.toContain('events')
  })
})

describe('completionService — dot notation (table.)', () => {
  it('does not return columns for invalid FROM table-dot syntax', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SELECT * FROM users.',
      pos(1, 21),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.COLUMN, wordRanges: [] }],
        keywords: [],
      }),
      null,
      '.'
    )

    expect(items.map(getLabel)).toEqual([])
  })

  it('returns columns for a table when trigger is dot after table name in valid column context', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SELECT users.',
      pos(1, 14),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.COLUMN, wordRanges: [] }],
        keywords: [],
      }),
      null,
      '.'
    )
    const labels = items.map(getLabel)
    expect(labels).toContain('id')
    expect(labels).toContain('email')
    expect(labels).toContain('name')
    // Should NOT include columns from other tables
    expect(labels).not.toContain('title')
    expect(labels).not.toContain('event_id')
  })
})

describe('completionService — snippet handling', () => {
  it('maps snippets to CompletionItem with InsertAsSnippet insertTextRules', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const snippets = [
      {
        prefix: 'sel',
        label: 'SELECT statement',
        body: 'SELECT ${1:columns} FROM ${2:table}',
        insertText: 'SELECT ${1:columns} FROM ${2:table}',
        description: 'Basic SELECT',
      },
    ]
    const items = await callService(
      'SE',
      pos(1, 3),
      buildSuggestions({ keywords: ['SELECT'] }),
      null,
      undefined,
      snippets
    )
    const snippetItems = items.filter(
      (i: AnyItem) => i.kind === languages.CompletionItemKind.Snippet
    )
    expect(snippetItems).toHaveLength(1)
    expect(getLabel(snippetItems[0])).toBe('SELECT statement')
    expect(snippetItems[0].insertText).toBe('SELECT ${1:columns} FROM ${2:table}')
    expect(snippetItems[0].insertTextRules).toBe(
      languages.CompletionItemInsertTextRule.InsertAsSnippet
    )
  })

  it('converts snippet body array to single string', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const snippets = [
      {
        prefix: 'ins',
        label: 'INSERT snippet',
        body: ['INSERT INTO ${1:table}', '(${2:columns})', 'VALUES (${3:values})'],
        description: 'INSERT template',
      },
    ]
    const items = await callService(
      'SE',
      pos(1, 3),
      buildSuggestions({ keywords: [] }),
      null,
      undefined,
      snippets
    )
    const snippetItems = items.filter(
      (i: AnyItem) => i.kind === languages.CompletionItemKind.Snippet
    )
    expect(snippetItems).toHaveLength(1)
    expect(snippetItems[0].insertText).toBe(
      'INSERT INTO ${1:table}\n(${2:columns})\nVALUES (${3:values})'
    )
  })

  it('filters out built-in snippet completions with lowercase/hyphenated labels', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const snippets = [
      {
        prefix: 'select',
        label: 'select-join',
        body: 'select * from ${1:table1} join ${2:table2}',
        description: 'bad built-in snippet',
      },
      {
        prefix: 'sel',
        label: 'SELECT statement',
        body: 'SELECT ${1:columns} FROM ${2:table}',
        description: 'good snippet',
      },
    ]

    const items = await callService(
      'selec',
      pos(1, 6),
      buildSuggestions({ keywords: ['SELECT'] }),
      null,
      undefined,
      snippets
    )

    const labels = items.map(getLabel)
    expect(labels).toContain('SELECT')
    expect(labels).toContain('SELECT statement')
    expect(labels).not.toContain('select-join')
  })
})

describe('completionService — empty/ready cache with no syntax matches', () => {
  it('returns keywords from suggestions even when cache is empty', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(EMPTY_CACHE)

    const items = await callService(
      'SE',
      pos(1, 3),
      buildSuggestions({ keywords: ['SELECT', 'SET'] })
    )
    const labels = items.map(getLabel)
    expect(labels).toContain('SELECT')
    expect(labels).toContain('SET')
  })
})

describe('completionService — multiple syntax types', () => {
  it('handles both DATABASE and TABLE syntax in a single suggestions object', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SELECT * FROM ',
      pos(1, 15),
      buildSuggestions({
        syntax: [
          { syntaxContextType: EntityContextType.DATABASE, wordRanges: [] },
          { syntaxContextType: EntityContextType.TABLE, wordRanges: [] },
        ],
        keywords: ['FROM'],
      })
    )
    const labels = items.map(getLabel)
    // Databases
    expect(labels).toContain('app_db')
    expect(labels).toContain('analytics_db')
    // Keywords
    expect(labels).toContain('FROM')
  })
})

describe('completionService — no range set on items', () => {
  it('does not set range on completion items (library handles it)', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SELECT ',
      pos(1, 8),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.TABLE, wordRanges: [] }],
        keywords: ['SELECT'],
      })
    )
    for (const item of items) {
      expect(item.range).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------------------
// Alias resolution integration tests
// ---------------------------------------------------------------------------

describe('completionService — alias resolution via dot notation', () => {
  it('returns columns for an aliased table (unqualified alias with activeDatabase)', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: 'app_db' },
        sessionDatabase: 'app_db',
        status: 'connected',
      },
    }

    const entities = [buildEntityWithAlias(EntityContextType.TABLE, 'users', 't', true)]
    const items = await callService(
      'SELECT * FROM users t WHERE t.',
      pos(1, 31),
      buildSuggestions({ syntax: [], keywords: [] }),
      entities,
      '.'
    )
    const labels = items.map(getLabel)
    expect(labels).toContain('id')
    expect(labels).toContain('email')
    expect(labels).toContain('name')
    // Should NOT include columns from other tables
    expect(labels).not.toContain('title')
    expect(labels).not.toContain('event_id')
  })

  it('returns columns for a cross-database alias (analytics_db.events)', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: 'app_db' },
        sessionDatabase: 'app_db',
        status: 'connected',
      },
    }

    const entities = [
      buildEntityWithAlias(EntityContextType.TABLE, 'analytics_db.events', 'e', true),
    ]
    const items = await callService(
      'SELECT * FROM analytics_db.events e WHERE e.',
      pos(1, 46),
      buildSuggestions({ syntax: [], keywords: [] }),
      entities,
      '.'
    )
    const labels = items.map(getLabel)
    expect(labels).toContain('event_id')
    expect(labels).toContain('event_type')
    // Should NOT include columns from app_db tables
    expect(labels).not.toContain('email')
    expect(labels).not.toContain('title')
  })

  it('falls through to db/table matching when word before dot is not an alias', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: 'app_db' },
        sessionDatabase: 'app_db',
        status: 'connected',
      },
    }

    // Entity with alias 't', but we type 'app_db.' — should suggest tables, not alias columns
    const entities = [buildEntityWithAlias(EntityContextType.TABLE, 'users', 't', true)]
    const items = await callService(
      'SELECT * FROM app_db.',
      pos(1, 22),
      buildSuggestions({ syntax: [], keywords: [] }),
      entities,
      '.'
    )
    const labels = items.map(getLabel)
    // Should suggest tables from app_db, not columns
    expect(labels).toContain('users')
    expect(labels).toContain('products')
  })

  it('returns empty when alias resolves but database/table not in cache', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: 'nonexistent_db' },
        sessionDatabase: 'nonexistent_db',
        status: 'connected',
      },
    }

    // Entity references a table not in the cache
    const entities = [buildEntityWithAlias(EntityContextType.TABLE, 'missing_table', 't', true)]
    const items = await callService(
      'SELECT t.',
      pos(1, 10),
      buildSuggestions({ syntax: [], keywords: [] }),
      entities,
      '.'
    )
    // No columns found for nonexistent_db.missing_table, falls through
    expect(items).toHaveLength(0)
  })
})

describe('completionService — text-based alias fallback (entities null)', () => {
  it('resolves alias from SQL text when entities are null', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: 'app_db' },
        sessionDatabase: 'app_db',
        status: 'connected',
      },
    }

    // entities is null (parser didn't produce entities) but SQL text has alias
    const items = await callService(
      'SELECT * FROM users t WHERE t.',
      pos(1, 31),
      buildSuggestions({ syntax: [], keywords: [] }),
      null, // entities null — triggers text-based fallback
      '.'
    )
    const labels = items.map(getLabel)
    expect(labels).toContain('id')
    expect(labels).toContain('email')
    expect(labels).toContain('name')
  })

  it('resolves cross-database alias from SQL text when entities are null', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: 'app_db' },
        sessionDatabase: 'app_db',
        status: 'connected',
      },
    }

    const items = await callService(
      'SELECT * FROM analytics_db.events e WHERE e.',
      pos(1, 46),
      buildSuggestions({ syntax: [], keywords: [] }),
      null, // entities null
      '.'
    )
    const labels = items.map(getLabel)
    expect(labels).toContain('event_id')
    expect(labels).toContain('event_type')
  })

  it('resolves aliases declared later in the same statement when editing the SELECT list', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: 'app_db' },
        sessionDatabase: 'app_db',
        status: 'connected',
      },
    }

    const items = await callService(
      'SELECT u. FROM users u',
      pos(1, 10),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.COLUMN, wordRanges: [] }],
        keywords: [],
      }),
      null,
      '.'
    )

    const labels = items.map(getLabel)
    expect(labels).toContain('id')
    expect(labels).toContain('email')
    expect(labels).toContain('name')
    expect(labels).not.toContain('title')
    expect(labels).not.toContain('event_id')
  })
})

// ---------------------------------------------------------------------------
// Context-aware ranking tests
// ---------------------------------------------------------------------------

describe('completionService — context-aware ranking', () => {
  it('column context → columns get sortText "0_" prefix, keywords get "2_" prefix', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SELECT * FROM users WHERE ',
      pos(1, 27),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.COLUMN, wordRanges: [] }],
        keywords: ['AND', 'OR', 'LIKE'],
      }),
      [buildEntity(EntityContextType.TABLE, 'users', true)]
    )

    // Column items should have '0_' prefix
    const colItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Field)
    expect(colItems.length).toBeGreaterThan(0)
    for (const col of colItems) {
      expect(col.sortText).toMatch(/^0_/)
    }

    // Keyword items should have '2_' prefix
    const kwItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Keyword)
    expect(kwItems.length).toBeGreaterThan(0)
    for (const kw of kwItems) {
      expect(kw.sortText).toMatch(/^2_/)
    }
  })

  it('table-reference context ranks schema above keywords', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockUseSchemaStoreGetState.mockReturnValue({
      connectionStates: {
        'conn-1': {
          selectedNodeId: 'database:app_db:app_db',
        },
      },
    } as never)

    const items = await callService(
      'SELECT * FROM ',
      pos(1, 15),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.TABLE, wordRanges: [] }],
        keywords: ['FROM', 'WHERE'],
      })
    )

    // Table items should have '0_' prefix in table-reference context
    const tableItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Class)
    expect(tableItems.length).toBeGreaterThan(0)
    for (const table of tableItems) {
      expect(table.sortText).toMatch(/^0_/)
    }

    // Keyword items should rank below schema in table-reference context
    const kwItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Keyword)
    expect(kwItems.length).toBeGreaterThan(0)
    for (const kw of kwItems) {
      expect(kw.sortText).toMatch(/^2_/)
    }
  })

  it('keywords are still present in column context (not filtered out)', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SELECT * FROM users WHERE ',
      pos(1, 27),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.COLUMN, wordRanges: [] }],
        keywords: ['AND', 'OR', 'NOT', 'BETWEEN', 'LIKE'],
      }),
      [buildEntity(EntityContextType.TABLE, 'users', true)]
    )

    const labels = items.map(getLabel)
    // Keywords should be present (not hidden)
    expect(labels).toContain('AND')
    expect(labels).toContain('OR')
    expect(labels).toContain('NOT')
    expect(labels).toContain('BETWEEN')
    expect(labels).toContain('LIKE')

    // Columns should also be present
    expect(labels).toContain('id')
    expect(labels).toContain('email')
    expect(labels).toContain('name')
  })

  it('column context with mixed syntax types ranks columns higher than other schema items', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SELECT  FROM users',
      pos(1, 8),
      buildSuggestions({
        syntax: [
          { syntaxContextType: EntityContextType.COLUMN, wordRanges: [] },
          { syntaxContextType: EntityContextType.FUNCTION, wordRanges: [] },
        ],
        keywords: ['SELECT', 'DISTINCT'],
      }),
      [buildEntity(EntityContextType.TABLE, 'users', true)]
    )

    // Column items → '0_'
    const colItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Field)
    for (const col of colItems) {
      expect(col.sortText).toMatch(/^0_/)
    }

    // Function items → '1_' (neutral schema)
    const fnItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Function)
    for (const fn of fnItems) {
      expect(fn.sortText).toMatch(/^1_/)
    }

    // Keyword items → '2_'
    const kwItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Keyword)
    for (const kw of kwItems) {
      expect(kw.sortText).toMatch(/^2_/)
    }
  })

  it('parse-failure fallback (null suggestions) uses neutral "1_" for all items', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService('SELECT * FRM', pos(1, 13), null)

    // All items should have neutral '1_' prefix
    for (const item of items) {
      expect(item.sortText).toMatch(/^1_/)
    }
  })
})

// ---------------------------------------------------------------------------
// Issue 1: Parse-failure fallback awaits cache loading
// ---------------------------------------------------------------------------

describe('completionService — parse-failure fallback awaits cache', () => {
  it('loads cache before returning parse-failure fallback when cache is empty', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')

    // First call: cache is empty (not yet loaded)
    // After loadCache completes: cache is ready
    mockGetCache.mockReturnValueOnce(EMPTY_CACHE).mockReturnValue(READY_CACHE)

    const items = await callService('SELECT * FRM', pos(1, 13), null)
    const labels = items.map(getLabel)

    // loadCache should have been called because cache was empty
    expect(mockLoadCache).toHaveBeenCalledWith('conn-1')

    // Should have schema items because cache was loaded before parse-failure check
    expect(labels).toContain('users')
    expect(labels).toContain('app_db')
    expect(labels).toContain('id')
  })

  it('awaits pending cache load before returning parse-failure fallback', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')

    // Simulate a pending load promise
    mockGetPendingLoad.mockReturnValueOnce(Promise.resolve())
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService('SELECT * FRM', pos(1, 13), null)
    const labels = items.map(getLabel)

    // Should have awaited the pending load
    expect(mockGetPendingLoad).toHaveBeenCalledWith('conn-1')

    // Should have schema items
    expect(labels).toContain('users')
    expect(labels).toContain('app_db')
  })
})

// ---------------------------------------------------------------------------
// Issue 2: Empty suggestions.keywords fallback to SQL_KEYWORDS
// ---------------------------------------------------------------------------

describe('completionService — empty keywords fallback', () => {
  it('falls back to SQL_KEYWORDS when suggestions.keywords is empty and no connectionId', async () => {
    const items = await callService(
      'SE',
      pos(1, 3),
      buildSuggestions({ keywords: [] }) // empty keywords from parser
    )
    const labels = items.map(getLabel)

    // Should contain SQL_KEYWORDS (the fallback list)
    expect(labels).toContain('SELECT')
    expect(labels).toContain('FROM')
    expect(labels).toContain('WHERE')
    expect(labels).toContain('INSERT')
    expect(labels.length).toBeGreaterThan(0)

    // All should be keyword items
    expect(items.every((i: AnyItem) => i.kind === languages.CompletionItemKind.Keyword)).toBe(true)
  })

  it('uses parser-provided keywords when they are non-empty', async () => {
    const items = await callService(
      'SE',
      pos(1, 3),
      buildSuggestions({ keywords: ['SELECT', 'SET'] })
    )
    const labels = items.map(getLabel)

    expect(labels).toEqual(['SELECT', 'SET'])
    expect(items).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Issue 3: db.table. dot notation (qualified database prefix)
// ---------------------------------------------------------------------------

describe('completionService — dot notation (db.table.)', () => {
  it('returns columns for db.table. syntax using exact database lookup', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SELECT analytics_db.events.',
      pos(1, 29),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.COLUMN, wordRanges: [] }],
        keywords: [],
      }),
      null,
      '.'
    )
    const labels = items.map(getLabel)
    // Should include columns from analytics_db.events (exact lookup)
    expect(labels).toContain('event_id')
    expect(labels).toContain('event_type')
    // Should NOT include columns from other tables
    expect(labels).not.toContain('id')
    expect(labels).not.toContain('email')
    expect(labels).not.toContain('title')
  })

  it('falls through to normal completion for db.table. when db.table is not in cache', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SELECT nonexistent_db.fake_table.',
      pos(1, 34),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.COLUMN, wordRanges: [] }],
        keywords: [],
      }),
      null,
      '.'
    )
    // Dot notation returns empty (no match), so normal column flow takes over.
    // With no scoped tables (entities is null), broad fallback returns all columns.
    const colItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Field)
    expect(colItems.length).toBeGreaterThan(0)
  })

  it('single db. prefix still returns tables for that database', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SELECT * FROM app_db.',
      pos(1, 22),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.TABLE, wordRanges: [] }],
        keywords: [],
      }),
      null,
      '.'
    )
    const labels = items.map(getLabel)
    expect(labels).toContain('users')
    expect(labels).toContain('products')
    expect(labels).not.toContain('events')
  })

  it('single table. prefix still returns columns (no qualifiedDb)', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService(
      'SELECT users.',
      pos(1, 14),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.COLUMN, wordRanges: [] }],
        keywords: [],
      }),
      null,
      '.'
    )
    const labels = items.map(getLabel)
    expect(labels).toContain('id')
    expect(labels).toContain('email')
    expect(labels).toContain('name')
  })

  it('db. prefix returns tables from that database during parse fallback', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService('SELECT * FROM app_db.', pos(1, 22), null)
    const labels = items.map(getLabel)

    expect(labels).toContain('users')
    expect(labels).toContain('products')
    expect(labels).not.toContain('events')
  })

  it('FROM without selected database returns only databases during parse fallback', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService('SELECT * FROM ', pos(1, 15), null)
    const labels = items.map(getLabel)

    expect(labels).toContain('app_db')
    expect(labels).toContain('analytics_db')
    expect(labels).not.toContain('users')
    expect(labels).not.toContain('products')
    expect(labels).not.toContain('events')
  })

  it('FROM parse fallback ranks databases above keywords when no database is selected', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService('SELECT * FROM ', pos(1, 15), null)
    const dbItems = items.filter(
      (item: AnyItem) =>
        item.kind === languages.CompletionItemKind.Module &&
        ['app_db', 'analytics_db'].includes(getLabel(item))
    )
    const keywordItems = items.filter(
      (item: AnyItem) => item.kind === languages.CompletionItemKind.Keyword
    )

    expect(dbItems.length).toBeGreaterThan(0)
    expect(keywordItems.length).toBeGreaterThan(0)

    for (const item of dbItems) {
      expect(item.sortText).toMatch(/^0_/)
    }

    for (const item of keywordItems) {
      expect(item.sortText).toMatch(/^2_/)
    }
  })

  it('FROM with selected database returns databases plus that database tables during parse fallback', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockUseSchemaStoreGetState.mockReturnValue({
      connectionStates: {
        'conn-1': {
          selectedNodeId: 'database:app_db:app_db',
        },
      },
    } as never)

    const items = await callService('SELECT * FROM ', pos(1, 15), null)
    const labels = items.map(getLabel)

    expect(labels).toContain('users')
    expect(labels).toContain('products')
    expect(labels).not.toContain('events')
    expect(labels).toContain('analytics_db')
  })

  it('FROM with selected database includes databases and selected tables during parse fallback', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockUseSchemaStoreGetState.mockReturnValue({
      connectionStates: {
        'conn-1': {
          selectedNodeId: 'database:analytics_db:analytics_db',
        },
      },
    } as never)

    const items = await callService('SELECT * FROM ', pos(1, 15), null)
    const labels = items.map(getLabel)

    expect(labels).toContain('analytics_db')
    expect(labels).toContain('app_db')
    expect(labels).toContain('events')
    expect(labels).not.toContain('users')

    const databaseItems = items.filter(
      (item: AnyItem) => item.kind === languages.CompletionItemKind.Module
    )
    const tableItems = items.filter(
      (item: AnyItem) => item.kind === languages.CompletionItemKind.Class
    )
    const keywordItems = items.filter(
      (item: AnyItem) => item.kind === languages.CompletionItemKind.Keyword
    )

    expect(databaseItems.every((item: AnyItem) => item.sortText.startsWith('0_'))).toBe(true)
    expect(tableItems.every((item: AnyItem) => item.sortText.startsWith('0_'))).toBe(true)
    expect(keywordItems.every((item: AnyItem) => item.sortText.startsWith('2_'))).toBe(true)
  })

  it('FROM ignores defaultDatabase during parse fallback when no tree node is selected', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: 'app_db' },
        sessionDatabase: 'app_db',
        status: 'connected',
      },
    }

    const items = await callService('SELECT * FROM ', pos(1, 15), null)
    const labels = items.map(getLabel)

    expect(labels).toContain('app_db')
    expect(labels).toContain('analytics_db')
    expect(labels).not.toContain('users')
    expect(labels).not.toContain('products')
    expect(labels).not.toContain('events')
  })

  it('selected node database overrides defaultDatabase during parse fallback while still listing databases', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: 'app_db' },
        sessionDatabase: 'app_db',
        status: 'connected',
      },
    }
    mockUseSchemaStoreGetState.mockReturnValue({
      connectionStates: {
        'conn-1': {
          selectedNodeId: 'category:analytics_db:table',
        },
      },
    } as never)

    const items = await callService('SELECT * FROM ', pos(1, 15), null)
    const labels = items.map(getLabel)

    expect(labels).toContain('events')
    expect(labels).not.toContain('users')
    expect(labels).not.toContain('products')
    expect(labels).toContain('analytics_db')
  })

  it('selected node database does not override defaultDatabase for alias column resolution', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: 'app_db' },
        status: 'connected',
      },
    }
    mockUseSchemaStoreGetState.mockReturnValue({
      connectionStates: {
        'conn-1': {
          selectedNodeId: 'category:analytics_db:table',
        },
      },
    } as never)

    const entities = [buildEntityWithAlias(EntityContextType.TABLE, 'users', 'u', true)]
    const items = await callService(
      'SELECT * FROM users u WHERE u.',
      pos(1, 31),
      buildSuggestions({ syntax: [], keywords: [] }),
      entities,
      '.'
    )

    const labels = items.map(getLabel)
    expect(labels).toContain('id')
    expect(labels).toContain('email')
    expect(labels).not.toContain('event_id')
    expect(labels).not.toContain('event_type')
  })

  it('selected node database resolves alias columns when defaultDatabase is missing', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: null },
        sessionDatabase: null,
        status: 'connected',
      },
    }
    mockUseSchemaStoreGetState.mockReturnValue({
      connectionStates: {
        'conn-1': {
          selectedNodeId: 'category:analytics_db:table',
        },
      },
    } as never)

    const entities = [buildEntityWithAlias(EntityContextType.TABLE, 'events', 'e', true)]
    const items = await callService(
      'SELECT * FROM events e WHERE e.',
      pos(1, 32),
      buildSuggestions({ syntax: [], keywords: [] }),
      entities,
      '.'
    )

    const labels = items.map(getLabel)
    expect(labels).toContain('event_id')
    expect(labels).toContain('event_type')
    expect(labels).not.toContain('email')
  })

  it('table. in FROM clause returns nothing during parse fallback', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    const items = await callService('SELECT * FROM users.', pos(1, 21), null)

    expect(items).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Issue: Unqualified table dot-notation prefers activeDatabase
// ---------------------------------------------------------------------------

describe('completionService — dot notation prefers activeDatabase for unqualified tables', () => {
  const MULTI_SCHEMA_CACHE = {
    status: 'ready' as const,
    databases: ['db_alpha', 'db_beta'],
    tables: {
      db_alpha: [
        { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 100, dataSize: 1024 },
      ],
      db_beta: [
        { name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 200, dataSize: 2048 },
      ],
    },
    columns: {
      'db_alpha.users': [
        { name: 'alpha_id', dataType: 'int' },
        { name: 'alpha_email', dataType: 'varchar(255)' },
      ],
      'db_beta.users': [
        { name: 'beta_id', dataType: 'int' },
        { name: 'beta_name', dataType: 'varchar(100)' },
      ],
    },
    routines: {},
  }

  it('unqualified table dot-notation prefers activeDatabase over other databases', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(MULTI_SCHEMA_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: 'db_beta' },
        sessionDatabase: 'db_beta',
        status: 'connected',
      },
    }

    // Type "users." — both db_alpha and db_beta have a "users" table.
    // With activeDatabase = db_beta, columns from db_beta.users should be returned.
    const items = await callService(
      'SELECT users.',
      pos(1, 14),
      buildSuggestions({ syntax: [], keywords: [] }),
      null,
      '.'
    )
    const labels = items.map(getLabel)
    expect(labels).toContain('beta_id')
    expect(labels).toContain('beta_name')
    // Should NOT include columns from db_alpha.users
    expect(labels).not.toContain('alpha_id')
    expect(labels).not.toContain('alpha_email')
  })

  it('unqualified table dot-notation falls back to first match when no activeDatabase', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(MULTI_SCHEMA_CACHE)
    // No activeDatabase set
    mockConnectionState.activeConnections = {}

    const items = await callService(
      'SELECT users.',
      pos(1, 14),
      buildSuggestions({ syntax: [], keywords: [] }),
      null,
      '.'
    )
    const labels = items.map(getLabel)
    // Should return columns from the first database in the list (db_alpha)
    expect(labels).toContain('alpha_id')
    expect(labels).toContain('alpha_email')
    expect(labels).not.toContain('beta_id')
    expect(labels).not.toContain('beta_name')
  })

  it('addColumnsForTable prefers activeDatabase for unqualified table refs in column context', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(MULTI_SCHEMA_CACHE)
    mockConnectionState.activeConnections = {
      'conn-1': {
        id: 'conn-1',
        profile: { defaultDatabase: 'db_beta' },
        sessionDatabase: 'db_beta',
        status: 'connected',
      },
    }

    // Entity references unqualified "users" table in caret statement
    const entities = [buildEntity(EntityContextType.TABLE, 'users', true)]
    const items = await callService(
      'SELECT  FROM users',
      pos(1, 8),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.COLUMN, wordRanges: [] }],
        keywords: [],
      }),
      entities
    )
    const colItems = items.filter((i: AnyItem) => i.kind === languages.CompletionItemKind.Field)
    const labels = colItems.map(getLabel)
    // activeDatabase is db_beta, so db_beta.users columns should come first
    expect(labels).toContain('beta_id')
    expect(labels).toContain('beta_name')
    // db_alpha.users columns are also added (addColumnsForTable iterates all)
    expect(labels).toContain('alpha_id')
    expect(labels).toContain('alpha_email')
  })
})

// ---------------------------------------------------------------------------
// Issue: Dot-notation activated on manual invoke (no triggerCharacter)
// ---------------------------------------------------------------------------

describe('completionService — dot-notation on manual invoke (Ctrl+Space)', () => {
  it('dot-notation activated when cursor is in middle of dotted word (manual invoke)', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    // User typed "users.em" and then pressed Ctrl+Space (no triggerCharacter).
    // The cursor is at col 9 ("users.em|"), triggerCharacter is undefined.
    // hasDottedPrefixBeforeWord should detect "users." before "em".
    const items = await callService(
      'SELECT users.em',
      pos(1, 16), // cursor at end of "em"
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.COLUMN, wordRanges: [] }],
        keywords: [],
      }),
      null,
      undefined // no triggerCharacter — manual invocation
    )
    const labels = items.map(getLabel)
    // Should still resolve "users." columns via dot-notation
    expect(labels).toContain('id')
    expect(labels).toContain('email')
    expect(labels).toContain('name')
    // Should NOT include columns from other tables
    expect(labels).not.toContain('title')
    expect(labels).not.toContain('event_id')
  })

  it('dot-notation activated for db. prefix on manual invoke', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)

    // User typed "app_db.us" and hit Ctrl+Space
    const items = await callService(
      'SELECT * FROM app_db.us',
      pos(1, 24), // cursor at end of "us"
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.TABLE, wordRanges: [] }],
        keywords: [],
      }),
      null,
      undefined // manual invoke
    )
    const labels = items.map(getLabel)
    // Should resolve "app_db." → tables from app_db
    expect(labels).toContain('users')
    expect(labels).toContain('products')
    expect(labels).not.toContain('events')
  })

  it('no false positive for non-dotted text on manual invoke', async () => {
    registerModelConnection('inmemory://model/1', 'conn-1')
    mockGetCache.mockReturnValue(READY_CACHE)
    mockUseSchemaStoreGetState.mockReturnValue({
      connectionStates: {
        'conn-1': {
          selectedNodeId: 'database:app_db:app_db',
        },
      },
    } as never)

    // User typed "SELECT " and hit Ctrl+Space — no dot in the text
    const items = await callService(
      'SELECT ',
      pos(1, 8),
      buildSuggestions({
        syntax: [{ syntaxContextType: EntityContextType.TABLE, wordRanges: [] }],
        keywords: ['FROM'],
      }),
      null,
      undefined // manual invoke
    )
    const labels = items.map(getLabel)
    // Should return normal table suggestions + keywords (not dot-notation)
    expect(labels).toContain('users')
    expect(labels).toContain('products')
    expect(labels).not.toContain('events')
    expect(labels).toContain('FROM')
  })
})
