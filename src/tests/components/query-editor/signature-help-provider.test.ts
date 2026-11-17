import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as monaco from 'monaco-editor'

// Use vi.spyOn to install per-test mock implementations without vi.mock().
// All dependencies (routine-parameter-cache, schema-metadata-cache, schema-cache-bootstrap,
// completion-service) are only called at runtime inside provideSignatureHelp, not at import
// time — so vi.spyOn in beforeEach is sufficient.

import * as RoutineParameterCacheModule from '../../../components/query-editor/routine-parameter-cache'
import * as SchemaMetadataCacheModule from '../../../components/query-editor/schema-metadata-cache'
import * as SchemaCacheBootstrapModule from '../../../lib/schema-cache-bootstrap'
import * as CompletionServiceModule from '../../../components/query-editor/completion-service'
import * as ConnectionStoreModule from '../../../stores/connection-store'

// Import the module under test — triggers side-effect registration
import {
  _parseFunctionContext,
  isEscapedChar,
} from '../../../components/query-editor/signature-help-provider'

// ---------------------------------------------------------------------------
// Capture the registered provider IMMEDIATELY after import (before beforeEach
// clears mock calls)
// ---------------------------------------------------------------------------

type ProviderType = {
  signatureHelpTriggerCharacters: string[]
  signatureHelpRetriggerCharacters: string[]
  provideSignatureHelp: (
    model: unknown,
    position: unknown,
    token: unknown,
    context: unknown
  ) => Promise<unknown>
}

const registrationCalls = vi.mocked(monaco.languages.registerSignatureHelpProvider).mock.calls
const capturedProvider: ProviderType = registrationCalls[0][1] as ProviderType

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockModel(sql: string) {
  const lines = sql.split('\n')
  const offset = sql.length
  return {
    getValue: () => sql,
    getOffsetAt: () => offset,
    uri: { toString: () => 'file:///test.sql' },
    getLineContent: (lineNumber: number) => lines[lineNumber - 1] ?? '',
  }
}

function mockToken(cancelled = false) {
  return { isCancellationRequested: cancelled, onCancellationRequested: vi.fn() }
}

function mockPosition() {
  return { lineNumber: 1, column: 1 }
}

// ---------------------------------------------------------------------------
// Accessor helpers for spied functions
// ---------------------------------------------------------------------------

function mockGetRoutineParameters() {
  return RoutineParameterCacheModule.getRoutineParameters as ReturnType<typeof vi.fn>
}

function mockGetCache() {
  return SchemaMetadataCacheModule.getCache as ReturnType<typeof vi.fn>
}

function mockGetPendingLoad() {
  return SchemaMetadataCacheModule.getPendingLoad as ReturnType<typeof vi.fn>
}

function mockGetModelConnectionId() {
  return CompletionServiceModule.getModelConnectionId as ReturnType<typeof vi.fn>
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(RoutineParameterCacheModule, 'getRoutineParameters').mockReset().mockResolvedValue(null)
  vi.spyOn(SchemaMetadataCacheModule, 'getCache')
    .mockReset()
    .mockReturnValue({ status: 'ready', routines: {} } as never)
  vi.spyOn(SchemaMetadataCacheModule, 'getPendingLoad').mockReset().mockReturnValue(null)
  vi.spyOn(SchemaMetadataCacheModule, 'loadCache').mockReset().mockResolvedValue(undefined)
  vi.spyOn(SchemaCacheBootstrapModule, 'getPendingBootstrap').mockReset().mockReturnValue(null)
  vi.spyOn(CompletionServiceModule, 'getModelConnectionId').mockReset().mockReturnValue(undefined)
  vi.spyOn(CompletionServiceModule, 'getSelectedDatabase').mockReset().mockReturnValue(null)

  // Reset connection store to empty state
  ConnectionStoreModule.useConnectionStore.setState({ activeConnections: {} } as never)
})

// ---------------------------------------------------------------------------
// Tests for _parseFunctionContext
// ---------------------------------------------------------------------------

describe('_parseFunctionContext', () => {
  it('returns null for empty string', () => {
    expect(_parseFunctionContext('', 0)).toBeNull()
  })

  it('ignores commas inside block comments', () => {
    const sql = 'SELECT FUNC(/* a, b */ '
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.activeParameter).toBe(0)
  })

  it('handles backtick-quoted identifiers', () => {
    const sql = 'SELECT `my_func`('
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.functionName).toBe('my_func')
  })

  it('skips backtick-quoted identifiers in backward paren scan', () => {
    // Backtick-quoted identifiers should be skipped when scanning backward for the open paren
    const sql = 'SELECT FUNC(`col name`, '
    const result = _parseFunctionContext(sql, sql.length)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('FUNC')
    expect(result!.activeParameter).toBe(1)
  })

  // -------------------------------------------------------------------------
  // Fix 1 — line comment handling in backward scan
  // -------------------------------------------------------------------------

  it('does not count parameters inside -- line comment', () => {
    const sql = 'SELECT FUNC(a, -- b, c\n'
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.activeParameter).toBe(1) // only the comma before "-- " counts
  })

  it('treats -- without trailing space as NOT a comment (MySQL rule)', () => {
    // --x is not a comment in MySQL; it should be treated as identifiers/operators
    const sql = 'SELECT FUNC(--x,\n'
    const result = _parseFunctionContext(sql, sql.length)
    // --x is not a comment so the comma after it counts
    expect(result!.activeParameter).toBe(1)
  })

  // -------------------------------------------------------------------------
  // Fix 2 — doubled-quote escape handling in countActiveParameter
  // -------------------------------------------------------------------------

  it('does not miscount comma inside doubled-quote string', () => {
    // FUNC('it''s cool, right', x) — one string arg with comma inside, then x
    const sql = "SELECT FUNC('it''s cool, right', x)"
    const result = _parseFunctionContext(sql, sql.length - 1)
    expect(result).not.toBeNull()
    expect(result!.activeParameter).toBe(1) // x is param index 1
  })

  // -------------------------------------------------------------------------
  // Fix 3 — backslash-escaped quote handling in findLineCommentStart
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Fix 4 — backslash-escaped double-quote handling in backward scan
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Fix 5 — backslash-escaped double-quote in countActiveParameter forward scan
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Fix 6 — even backslash runs before quotes should not be treated as escapes
  // -------------------------------------------------------------------------

  it('handles even backslash run before closing single quote (forward scan)', () => {
    // SQL text: FUNC('C:\\temp\\', x) — two backslashes before closing '
    // The \\\\ in JS becomes \\ in the actual string
    const sql = "FUNC('C:\\\\temp\\\\', x)"
    // Cursor before closing paren
    const result = _parseFunctionContext(sql, sql.length - 1)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('FUNC')
    // The comma between the string and x is outside the string → activeParameter = 1
    expect(result!.activeParameter).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Tests for isEscapedChar helper
// ---------------------------------------------------------------------------

describe('isEscapedChar', () => {
  it('returns false when no backslashes precede pos', () => {
    expect(isEscapedChar("abc'", 3)).toBe(false)
  })

  it('returns true for three backslashes (odd)', () => {
    expect(isEscapedChar("\\\\\\\\'", 3)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests for the provider callback
// ---------------------------------------------------------------------------

describe('signature help provider registration', () => {
  it('was registered with correct trigger characters', () => {
    // Provider was captured at module level — verify properties
    expect(capturedProvider).toBeDefined()
    expect(capturedProvider.signatureHelpTriggerCharacters).toEqual(['(', ','])
    expect(capturedProvider.signatureHelpRetriggerCharacters).toEqual([','])
    expect(typeof capturedProvider.provideSignatureHelp).toBe('function')
  })
})

describe('provideSignatureHelp — built-in functions', () => {
  it('returns undefined for unknown function without connection', async () => {
    const sql = 'SELECT unknown_func('
    const model = mockModel(sql)
    const result = await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )

    // No builtin match, no connectionId → undefined
    expect(result).toBeUndefined()
  })

  it('returns undefined when cursor is not inside any function call', async () => {
    const sql = 'SELECT * FROM t WHERE '
    const model = mockModel(sql)
    const result = await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )

    expect(result).toBeUndefined()
  })
})

describe('provideSignatureHelp — cancellation', () => {
  it('returns undefined when token is cancelled', async () => {
    mockGetModelConnectionId().mockReturnValue('conn-1')
    const sql = 'SELECT unknown_func('
    const model = mockModel(sql)
    const result = await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(true),
      {}
    )

    expect(result).toBeUndefined()
  })
})

describe('provideSignatureHelp — built-in function has documentation', () => {
  it('includes return type and documentation in built-in signature', async () => {
    const sql = 'SELECT ABS('
    const model = mockModel(sql)
    const result = (await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )) as {
      value: {
        signatures: Array<{ label: string; documentation: { value: string } }>
      }
    } | null

    expect(result).not.toBeNull()
    expect(result!.value.signatures[0].documentation.value).toContain('NUMERIC')
    expect(result!.value.signatures[0].documentation.value).toContain('absolute value')
  })
})

describe('provideSignatureHelp — case insensitive', () => {
  it('matches built-in functions case-insensitively', async () => {
    const sql = 'SELECT concat('
    const model = mockModel(sql)
    const result = (await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )) as { value: { signatures: Array<{ label: string }> } } | null

    expect(result).not.toBeNull()
    expect(result!.value.signatures[0].label).toContain('CONCAT')
  })
})

describe('provideSignatureHelp — dispose method', () => {
  it('result has a dispose method', async () => {
    const sql = 'SELECT CONCAT('
    const model = mockModel(sql)
    const result = (await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )) as { dispose: () => void } | null

    expect(result).not.toBeNull()
    expect(typeof result!.dispose).toBe('function')
    // Should not throw
    result!.dispose()
  })
})

// ---------------------------------------------------------------------------
// Tests for stored routine lookup paths
// ---------------------------------------------------------------------------

describe('provideSignatureHelp — database-qualified stored routine', () => {
  it('returns undefined when database-qualified routine is not found', async () => {
    mockGetModelConnectionId().mockReturnValue('conn-1')
    ConnectionStoreModule.useConnectionStore.setState({
      activeConnections: {
        'conn-1': { sessionDatabase: 'mydb', profile: {} },
      },
    } as never)
    mockGetRoutineParameters().mockResolvedValue(null)

    const sql = 'SELECT mydb.unknown_func('
    const model = mockModel(sql)
    const result = await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )

    expect(result).toBeUndefined()
  })

  it('returns undefined when cancelled during database-qualified lookup', async () => {
    mockGetModelConnectionId().mockReturnValue('conn-1')
    ConnectionStoreModule.useConnectionStore.setState({
      activeConnections: {
        'conn-1': { sessionDatabase: 'mydb', profile: {} },
      },
    } as never)
    // Simulate slow fetch — token becomes cancelled before result
    let resolveRoutine: (v: unknown) => void
    mockGetRoutineParameters().mockReturnValue(
      new Promise((resolve) => {
        resolveRoutine = resolve
      })
    )

    const token = { isCancellationRequested: false, onCancellationRequested: vi.fn() }
    const sql = 'SELECT mydb.my_func('
    const model = mockModel(sql)
    const promise = capturedProvider.provideSignatureHelp(model, mockPosition(), token, {})

    // Cancel while waiting
    token.isCancellationRequested = true
    resolveRoutine!({
      parameters: [{ name: 'x', dataType: 'INT', mode: null }],
      returnType: 'INT',
    })

    const result = await promise
    expect(result).toBeUndefined()
  })
})

describe('provideSignatureHelp — unqualified stored routine via cache', () => {
  it('returns signature when routine found in session database via cache', async () => {
    mockGetModelConnectionId().mockReturnValue('conn-1')
    ConnectionStoreModule.useConnectionStore.setState({
      activeConnections: {
        'conn-1': { sessionDatabase: 'testdb', profile: { defaultDatabase: '' } },
      },
    } as never)
    mockGetCache().mockReturnValue({
      status: 'ready',
      routines: {
        testdb: [{ name: 'my_proc', routineType: 'PROCEDURE' }],
      },
    } as never)
    mockGetRoutineParameters().mockResolvedValue({
      parameters: [
        { name: 'p1', dataType: 'VARCHAR(255)', mode: 'IN' },
        { name: 'p2', dataType: 'INT', mode: 'OUT' },
      ],
      returnType: null,
    })

    const sql = 'CALL my_proc('
    const model = mockModel(sql)
    const result = (await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )) as {
      value: {
        signatures: Array<{ label: string; parameters: Array<{ label: string }> }>
        activeParameter: number
      }
    } | null

    expect(result).not.toBeNull()
    expect(result!.value.signatures[0].label).toContain('my_proc')
    expect(result!.value.signatures[0].parameters).toHaveLength(2)
    expect(result!.value.signatures[0].parameters[0].label).toBe('IN p1 VARCHAR(255)')
    expect(result!.value.signatures[0].parameters[1].label).toBe('OUT p2 INT')
    expect(mockGetRoutineParameters()).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      database: 'testdb',
      routineName: 'my_proc',
      routineType: 'PROCEDURE',
    })
  })

  it('awaits pending cache load before lookup', async () => {
    mockGetModelConnectionId().mockReturnValue('conn-1')
    ConnectionStoreModule.useConnectionStore.setState({
      activeConnections: {
        'conn-1': { sessionDatabase: 'testdb', profile: {} },
      },
    } as never)
    mockGetPendingLoad().mockReturnValue(Promise.resolve())
    mockGetCache().mockReturnValue({ status: 'ready', routines: {} } as never)

    const sql = 'SELECT some_func('
    const model = mockModel(sql)
    const result = await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )

    expect(result).toBeUndefined()
    expect(mockGetPendingLoad()).toHaveBeenCalledWith('conn-1')
  })

  it('includes return type in documentation for functions', async () => {
    mockGetModelConnectionId().mockReturnValue('conn-1')
    ConnectionStoreModule.useConnectionStore.setState({
      activeConnections: {
        'conn-1': { sessionDatabase: 'testdb', profile: {} },
      },
    } as never)
    mockGetCache().mockReturnValue({
      status: 'ready',
      routines: {
        testdb: [{ name: 'calc', routineType: 'FUNCTION' }],
      },
    } as never)
    mockGetRoutineParameters().mockResolvedValue({
      parameters: [{ name: 'x', dataType: 'DECIMAL', mode: null }],
      returnType: 'DECIMAL(10,2)',
    })

    const sql = 'SELECT calc('
    const model = mockModel(sql)
    const result = (await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )) as {
      value: {
        signatures: Array<{ documentation?: { value: string } }>
      }
    } | null

    expect(result).not.toBeNull()
    expect(result!.value.signatures[0].documentation!.value).toContain('DECIMAL(10,2)')
  })
})

// ---------------------------------------------------------------------------
// Tests for qualified CALL, same-name disambiguation, line comments (Fix 1/5)
// ---------------------------------------------------------------------------

describe('provideSignatureHelp — qualified CALL should look up procedure', () => {
  it('CALL mydb.my_proc( returns procedure signature from cache', async () => {
    mockGetModelConnectionId().mockReturnValue('conn-1')
    ConnectionStoreModule.useConnectionStore.setState({
      activeConnections: {
        'conn-1': { sessionDatabase: 'testdb', profile: {} },
      },
    } as never)
    mockGetRoutineParameters().mockResolvedValue({
      parameters: [
        { name: 'p1', dataType: 'INT', mode: 'IN' },
        { name: 'p2', dataType: 'TEXT', mode: 'OUT' },
      ],
      returnType: null,
      routineType: 'PROCEDURE',
    })

    const sql = 'CALL mydb.my_proc('
    const model = mockModel(sql)
    const result = (await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )) as {
      value: {
        signatures: Array<{ label: string; parameters: Array<{ label: string }> }>
      }
    } | null

    expect(result).not.toBeNull()
    expect(result!.value.signatures[0].label).toContain('my_proc')
    expect(result!.value.signatures[0].parameters).toHaveLength(2)
    // Must have called with procedure type (not function)
    expect(mockGetRoutineParameters()).toHaveBeenCalledWith({
      connectionId: 'conn-1',
      database: 'mydb',
      routineName: 'my_proc',
      routineType: 'PROCEDURE',
    })
  })
})

describe('provideSignatureHelp — same-name disambiguation', () => {
  it('unqualified non-CALL foo( prefers built-in FOO over stored routine', async () => {
    // The built-in map has FOO (e.g. ABS). Even if a stored routine named abs exists,
    // the unqualified non-CALL case should return the built-in.
    const sql = 'SELECT abs('
    const model = mockModel(sql)
    const result = (await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )) as { value: { signatures: Array<{ label: string }> } } | null

    expect(result).not.toBeNull()
    // The built-in ABS label includes the uppercase function name
    expect(result!.value.signatures[0].label).toContain('ABS')
    // Should NOT have attempted a routine cache lookup
    expect(mockGetRoutineParameters()).not.toHaveBeenCalled()
  })
})

describe('provideSignatureHelp — line comment between name and paren', () => {
  it('FUNC -- comment then paren on next line resolves to built-in', async () => {
    const sql = 'SELECT CONCAT -- comment\n('
    const model = mockModel(sql)
    const result = (await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )) as { value: { signatures: Array<{ label: string }> } } | null

    expect(result).not.toBeNull()
    expect(result!.value.signatures[0].label).toContain('CONCAT')
  })
})
