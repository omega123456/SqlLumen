import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as monaco from 'monaco-editor'

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockGetRoutineParameters = vi.fn().mockResolvedValue(null)
vi.mock('../../../components/query-editor/routine-parameter-cache', () => ({
  getRoutineParameters: (...args: unknown[]) => mockGetRoutineParameters(...args),
}))

const mockGetCache = vi.fn().mockReturnValue({ status: 'ready', routines: {} })
const mockGetPendingLoad = vi.fn().mockReturnValue(null)
const mockLoadCache = vi.fn().mockResolvedValue(undefined)
vi.mock('../../../components/query-editor/schema-metadata-cache', () => ({
  getCache: (...args: unknown[]) => mockGetCache(...args),
  getPendingLoad: (...args: unknown[]) => mockGetPendingLoad(...args),
  loadCache: (...args: unknown[]) => mockLoadCache(...args),
}))

const mockGetModelConnectionId = vi.fn().mockReturnValue(undefined)
const mockGetSelectedDatabase = vi.fn().mockReturnValue(null)
vi.mock('../../../components/query-editor/completion-service', () => ({
  getModelConnectionId: (...args: unknown[]) => mockGetModelConnectionId(...args),
  getSelectedDatabase: (...args: unknown[]) => mockGetSelectedDatabase(...args),
}))

const mockConnectionState = {
  activeConnections: {} as Record<string, unknown>,
}
vi.mock('../../../stores/connection-store', () => ({
  useConnectionStore: {
    getState: () => mockConnectionState,
  },
}))

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
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockGetRoutineParameters.mockResolvedValue(null)
  mockGetCache.mockReturnValue({ status: 'ready', routines: {} })
  mockGetPendingLoad.mockReturnValue(null)
  mockLoadCache.mockResolvedValue(undefined)
  mockGetModelConnectionId.mockReturnValue(undefined)
  mockGetSelectedDatabase.mockReturnValue(null)
  mockConnectionState.activeConnections = {}
})

// ---------------------------------------------------------------------------
// Tests for _parseFunctionContext
// ---------------------------------------------------------------------------

describe('_parseFunctionContext', () => {
  it('returns null for empty string', () => {
    expect(_parseFunctionContext('', 0)).toBeNull()
  })

  it('returns null when cursor is not inside a function call', () => {
    const sql = 'SELECT * FROM t WHERE '
    expect(_parseFunctionContext(sql, sql.length)).toBeNull()
  })

  it('identifies simple function call', () => {
    const sql = 'SELECT CONCAT('
    const result = _parseFunctionContext(sql, sql.length)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('CONCAT')
    expect(result!.activeParameter).toBe(0)
    expect(result!.isCall).toBe(false)
    expect(result!.database).toBeNull()
  })

  it('tracks active parameter index with commas', () => {
    const sql = "SELECT CONCAT('a', "
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.functionName).toBe('CONCAT')
    expect(result!.activeParameter).toBe(1)
  })

  it('ignores commas inside nested function calls', () => {
    const sql = 'SELECT CONCAT(IF(1,2,3), '
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.functionName).toBe('CONCAT')
    expect(result!.activeParameter).toBe(1)
  })

  it('resolves to innermost function for nested calls', () => {
    const sql = 'SELECT CONCAT(UPPER('
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.functionName).toBe('UPPER')
    expect(result!.activeParameter).toBe(0)
  })

  it('ignores commas inside string literals', () => {
    const sql = "SELECT CONCAT('a,b,c', "
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.functionName).toBe('CONCAT')
    expect(result!.activeParameter).toBe(1)
  })

  it('ignores commas inside block comments', () => {
    const sql = 'SELECT FUNC(/* a, b */ '
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.activeParameter).toBe(0)
  })

  it('ignores commas inside line comments', () => {
    const sql = 'SELECT FUNC(-- a, b\n'
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.activeParameter).toBe(0)
  })

  it('detects database-qualified function names', () => {
    const sql = 'SELECT mydb.my_func('
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.functionName).toBe('my_func')
    expect(result!.database).toBe('mydb')
  })

  it('detects CALL keyword as procedure', () => {
    const sql = 'CALL my_proc('
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.functionName).toBe('my_proc')
    expect(result!.isCall).toBe(true)
  })

  it('does not detect CALL for regular SELECT function', () => {
    const sql = 'SELECT my_func('
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.isCall).toBe(false)
  })

  it('handles backtick-quoted identifiers', () => {
    const sql = 'SELECT `my_func`('
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.functionName).toBe('my_func')
  })

  it('handles whitespace between function name and paren', () => {
    const sql = 'SELECT CONCAT  ('
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.functionName).toBe('CONCAT')
  })

  it('handles CALL with database-qualified procedure', () => {
    const sql = 'CALL mydb.my_proc('
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.functionName).toBe('my_proc')
    expect(result!.database).toBe('mydb')
    expect(result!.isCall).toBe(true)
  })

  it('handles hash line comments in forward scan', () => {
    const sql = 'SELECT FUNC(# a, b\n'
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.activeParameter).toBe(0)
  })

  it('handles multiple parameters', () => {
    const sql = 'SELECT CONCAT(a, b, c, '
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.activeParameter).toBe(3)
  })

  it('skips double-quoted strings in backward paren scan', () => {
    // The ')' inside the double-quoted column alias should be ignored during backward scan
    const sql = 'SELECT FUNC("col", '
    const result = _parseFunctionContext(sql, sql.length)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('FUNC')
    expect(result!.activeParameter).toBe(1)
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

  it('resolves function name through -- line comment before paren', () => {
    const sql = 'SELECT FUNC -- comment\n('
    const result = _parseFunctionContext(sql, sql.length)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('FUNC')
    expect(result!.activeParameter).toBe(0)
  })

  it('resolves function name through # line comment before paren', () => {
    const sql = 'SELECT FUNC # comment\n('
    const result = _parseFunctionContext(sql, sql.length)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('FUNC')
    expect(result!.activeParameter).toBe(0)
  })

  it('does not count parameters inside -- line comment', () => {
    const sql = 'SELECT FUNC(a, -- b, c\n'
    const result = _parseFunctionContext(sql, sql.length)
    expect(result!.activeParameter).toBe(1) // only the comma before "-- " counts
  })

  it('ignores parens inside -- line comments during backward scan', () => {
    const sql = 'SELECT OUTER(1, INNER -- )\n('
    const result = _parseFunctionContext(sql, sql.length)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('INNER')
  })

  it('detects CALL through -- line comment', () => {
    const sql = 'CALL -- comment\nmy_proc('
    const result = _parseFunctionContext(sql, sql.length)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('my_proc')
    expect(result!.isCall).toBe(true)
  })

  it('detects CALL through # line comment', () => {
    const sql = 'CALL # comment\nmy_proc('
    const result = _parseFunctionContext(sql, sql.length)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('my_proc')
    expect(result!.isCall).toBe(true)
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

  it('handles SQL doubled single-quote escape inside string', () => {
    // 'a'',b' is the SQL string a',b — the comma is inside the string
    // Cursor at end (after the closing paren) gives activeParameter=1
    // because x is the second argument
    const sql = "SELECT FUNC('a'',b', x)"
    const result = _parseFunctionContext(sql, sql.length - 1) // cursor before )
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('FUNC')
    expect(result!.activeParameter).toBe(1) // x is the second parameter
  })

  it('handles doubled single-quote at end of string', () => {
    // 'a''' is the SQL string a' — three quotes: open, a, '', close
    const sql = "SELECT FUNC('a''', x)"
    const result = _parseFunctionContext(sql, sql.length - 1)
    expect(result).not.toBeNull()
    expect(result!.activeParameter).toBe(1)
  })

  it('handles doubled double-quote escape in identifier/string', () => {
    // "a"",b" with doubled double-quote escape
    const sql = 'SELECT FUNC("a"",b", x)'
    const result = _parseFunctionContext(sql, sql.length - 1)
    expect(result).not.toBeNull()
    expect(result!.activeParameter).toBe(1)
  })

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

  it('handles backslash-escaped single quotes before a line comment', () => {
    // The \' inside the string should NOT end the string early.
    // The -- after the closing quote IS a real comment, not inside the string.
    // Line: SELECT 'foo\' bar', x -- real comment
    // Next line: FUNC(
    const sql = "SELECT 'foo\\' bar', x -- real comment\nFUNC("
    const result = _parseFunctionContext(sql, sql.length)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('FUNC')
    expect(result!.activeParameter).toBe(0)
  })

  it('does not treat -- inside backslash-escaped string as comment', () => {
    // 'foo\' -- still string' — the \' does not end the string,
    // so -- is inside the string literal and is NOT a comment.
    const sql = "SELECT FUNC('foo\\' -- still string', x)"
    const result = _parseFunctionContext(sql, sql.length - 1)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('FUNC')
    expect(result!.activeParameter).toBe(1) // x is param index 1
  })

  // -------------------------------------------------------------------------
  // Fix 4 — backslash-escaped double-quote handling in backward scan
  // -------------------------------------------------------------------------

  it('handles backslash-escaped double quote in backward scan', () => {
    // "foo\"bar" is a double-quoted string containing a literal quote.
    // The backward scanner must not stop at the escaped \" inside the string.
    const sql = 'SELECT "foo\\"bar", FUNC('
    const result = _parseFunctionContext(sql, sql.length)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('FUNC')
    expect(result!.activeParameter).toBe(0)
  })

  // -------------------------------------------------------------------------
  // Fix 5 — backslash-escaped double-quote in countActiveParameter forward scan
  // -------------------------------------------------------------------------

  it('handles backslash-escaped double quote inside double-quoted string in forward scan', () => {
    // "a\"b,c" is a double-quoted string containing a\"b,c — the comma is inside the string.
    // Without the fix, \" causes the string to end early and the comma inside counts.
    const sql = 'FUNC("a\\"b,c", x)'
    // Cursor at position 13 — just before the argument-separating comma
    const result = _parseFunctionContext(sql, 13)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('FUNC')
    expect(result!.activeParameter).toBe(0) // comma is inside the string, not counted
  })

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

  it('handles even backslash run before closing double quote (forward scan)', () => {
    // SQL text: FUNC("C:\\temp\\", x) — two backslashes before closing "
    const sql = 'FUNC("C:\\\\temp\\\\", x)'
    const result = _parseFunctionContext(sql, sql.length - 1)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('FUNC')
    expect(result!.activeParameter).toBe(1)
  })

  it('handles even backslash run in backward scan for single quote', () => {
    // Backward scan encounters 'C:\\temp\\' and must correctly identify the opening quote
    const sql = "SELECT 'C:\\\\temp\\\\', FUNC("
    const result = _parseFunctionContext(sql, sql.length)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('FUNC')
    expect(result!.activeParameter).toBe(0)
  })

  it('handles even backslash run in backward scan for double quote', () => {
    const sql = 'SELECT "C:\\\\temp\\\\", FUNC('
    const result = _parseFunctionContext(sql, sql.length)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('FUNC')
    expect(result!.activeParameter).toBe(0)
  })

  it('still treats odd backslash run as escape', () => {
    // Single backslash before closing quote → quote IS escaped, string continues
    // SQL text: FUNC('a\', b') — the \' is escaped, so the string is a', b
    const sql = "FUNC('a\\', b')"
    const result = _parseFunctionContext(sql, sql.length - 1)
    expect(result).not.toBeNull()
    expect(result!.functionName).toBe('FUNC')
    // The comma is inside the string (after escaped \'), so activeParameter = 0
    expect(result!.activeParameter).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Tests for isEscapedChar helper
// ---------------------------------------------------------------------------

describe('isEscapedChar', () => {
  it('returns false when no backslashes precede pos', () => {
    expect(isEscapedChar("abc'", 3)).toBe(false)
  })

  it('returns true for single backslash (odd)', () => {
    expect(isEscapedChar("ab\\'", 3)).toBe(true)
  })

  it('returns false for two backslashes (even)', () => {
    expect(isEscapedChar("a\\\\'", 4)).toBe(false)
  })

  it('returns true for three backslashes (odd)', () => {
    expect(isEscapedChar("\\\\\\\\'", 3)).toBe(true)
  })

  it('returns false at position 0', () => {
    expect(isEscapedChar("'abc", 0)).toBe(false)
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
  it('returns signature for built-in CONCAT function', async () => {
    const sql = 'SELECT CONCAT('
    const model = mockModel(sql)
    const result = (await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )) as { value: { signatures: Array<{ label: string }>; activeParameter: number } } | null

    expect(result).not.toBeNull()
    expect(result!.value.signatures).toHaveLength(1)
    expect(result!.value.signatures[0].label).toContain('CONCAT')
  })

  it('advances activeParameter with commas for built-in function', async () => {
    const sql = "SELECT CONCAT('a', "
    const model = mockModel(sql)
    const result = (await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )) as { value: { signatures: unknown[]; activeParameter: number } } | null

    expect(result).not.toBeNull()
    expect(result!.value.activeParameter).toBe(1)
  })

  it('returns hint for innermost nested function', async () => {
    const sql = 'SELECT CONCAT(UPPER('
    const model = mockModel(sql)
    const result = (await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )) as { value: { signatures: Array<{ label: string }>; activeParameter: number } } | null

    expect(result).not.toBeNull()
    expect(result!.value.signatures[0].label).toContain('UPPER')
    expect(result!.value.activeParameter).toBe(0)
  })

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

  it('does NOT return built-in ABS for CALL ABS(', async () => {
    mockGetModelConnectionId.mockReturnValue('conn-1')
    mockConnectionState.activeConnections = {
      'conn-1': { sessionDatabase: 'testdb', profile: {} },
    }
    mockGetCache.mockReturnValue({ status: 'ready', routines: {} })
    mockGetRoutineParameters.mockResolvedValue(null)

    const sql = 'CALL ABS('
    const model = mockModel(sql)
    const result = await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )

    // Should NOT return the built-in ABS — it's a CALL, so look up stored procedure
    expect(result).toBeUndefined()
    // Should have attempted routine lookup with procedure type
    expect(mockGetRoutineParameters).not.toHaveBeenCalled()
  })

  it('does NOT return built-in ABS for mydb.abs(', async () => {
    mockGetModelConnectionId.mockReturnValue('conn-1')
    mockConnectionState.activeConnections = {
      'conn-1': { sessionDatabase: 'testdb', profile: {} },
    }
    mockGetRoutineParameters.mockResolvedValue(null)

    const sql = 'SELECT mydb.abs('
    const model = mockModel(sql)
    const result = await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )

    // Should NOT return the built-in ABS — it's database-qualified
    expect(result).toBeUndefined()
    // Should have attempted a database-qualified routine lookup
    expect(mockGetRoutineParameters).toHaveBeenCalledWith('conn-1', 'mydb', 'abs', 'FUNCTION')
  })
})

describe('provideSignatureHelp — cancellation', () => {
  it('returns undefined when token is cancelled', async () => {
    mockGetModelConnectionId.mockReturnValue('conn-1')
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
  it('returns signature for database-qualified function name', async () => {
    mockGetModelConnectionId.mockReturnValue('conn-1')
    mockConnectionState.activeConnections = {
      'conn-1': { sessionDatabase: 'mydb', profile: {} },
    }
    mockGetRoutineParameters.mockResolvedValue({
      parameters: [{ name: 'val', dataType: 'INT', mode: 'IN' }],
      returnType: 'INT',
    })

    const sql = 'SELECT mydb.my_func('
    const model = mockModel(sql)
    const result = (await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )) as {
      value: { signatures: Array<{ label: string; documentation?: { value: string } }> }
    } | null

    expect(result).not.toBeNull()
    expect(result!.value.signatures[0].label).toContain('my_func')
    expect(result!.value.signatures[0].label).toContain('IN val INT')
    expect(mockGetRoutineParameters).toHaveBeenCalledWith('conn-1', 'mydb', 'my_func', 'FUNCTION')
  })

  it('returns undefined when database-qualified routine is not found', async () => {
    mockGetModelConnectionId.mockReturnValue('conn-1')
    mockConnectionState.activeConnections = {
      'conn-1': { sessionDatabase: 'mydb', profile: {} },
    }
    mockGetRoutineParameters.mockResolvedValue(null)

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
    mockGetModelConnectionId.mockReturnValue('conn-1')
    mockConnectionState.activeConnections = {
      'conn-1': { sessionDatabase: 'mydb', profile: {} },
    }
    // Simulate slow fetch — token becomes cancelled before result
    let resolveRoutine: (v: unknown) => void
    mockGetRoutineParameters.mockReturnValue(
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
    mockGetModelConnectionId.mockReturnValue('conn-1')
    mockConnectionState.activeConnections = {
      'conn-1': { sessionDatabase: 'testdb', profile: { defaultDatabase: '' } },
    }
    mockGetCache.mockReturnValue({
      status: 'ready',
      routines: {
        testdb: [{ name: 'my_proc', routineType: 'PROCEDURE' }],
      },
    })
    mockGetRoutineParameters.mockResolvedValue({
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
    expect(mockGetRoutineParameters).toHaveBeenCalledWith(
      'conn-1',
      'testdb',
      'my_proc',
      'PROCEDURE'
    )
  })

  it('awaits cache load on first use and returns result after loading', async () => {
    mockGetModelConnectionId.mockReturnValue('conn-1')
    mockConnectionState.activeConnections = {
      'conn-1': { sessionDatabase: 'testdb', profile: { defaultDatabase: '' } },
    }
    // Start with empty cache, then transition to ready after loadCache resolves
    let loadCallCount = 0
    mockGetCache.mockImplementation(() => {
      if (loadCallCount === 0) {
        return { status: 'empty', routines: {} }
      }
      return {
        status: 'ready',
        routines: {
          testdb: [{ name: 'my_func', routineType: 'FUNCTION' }],
        },
      }
    })
    mockLoadCache.mockImplementation(async () => {
      loadCallCount++
    })
    mockGetRoutineParameters.mockResolvedValue({
      parameters: [{ name: 'x', dataType: 'INT', mode: 'IN' }],
      returnType: 'INT',
    })

    const sql = 'SELECT my_func('
    const model = mockModel(sql)
    const result = (await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )) as {
      value: { signatures: Array<{ label: string }> }
    } | null

    expect(mockLoadCache).toHaveBeenCalledWith('conn-1')
    expect(result).not.toBeNull()
    expect(result!.value.signatures[0].label).toContain('my_func')
  })

  it('awaits pending cache load before lookup', async () => {
    mockGetModelConnectionId.mockReturnValue('conn-1')
    mockConnectionState.activeConnections = {
      'conn-1': { sessionDatabase: 'testdb', profile: {} },
    }
    mockGetPendingLoad.mockReturnValue(Promise.resolve())
    mockGetCache.mockReturnValue({ status: 'ready', routines: {} })

    const sql = 'SELECT some_func('
    const model = mockModel(sql)
    const result = await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )

    expect(result).toBeUndefined()
    expect(mockGetPendingLoad).toHaveBeenCalledWith('conn-1')
  })

  it('returns undefined when no routine matches in any database', async () => {
    mockGetModelConnectionId.mockReturnValue('conn-1')
    mockConnectionState.activeConnections = {
      'conn-1': { sessionDatabase: 'testdb', profile: {} },
    }
    mockGetCache.mockReturnValue({
      status: 'ready',
      routines: {
        testdb: [{ name: 'other_func', routineType: 'FUNCTION' }],
      },
    })

    const sql = 'SELECT nonexistent('
    const model = mockModel(sql)
    const result = await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )

    expect(result).toBeUndefined()
  })

  it('includes return type in documentation for functions', async () => {
    mockGetModelConnectionId.mockReturnValue('conn-1')
    mockConnectionState.activeConnections = {
      'conn-1': { sessionDatabase: 'testdb', profile: {} },
    }
    mockGetCache.mockReturnValue({
      status: 'ready',
      routines: {
        testdb: [{ name: 'calc', routineType: 'FUNCTION' }],
      },
    })
    mockGetRoutineParameters.mockResolvedValue({
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

  it('resolves schemaTreeDb from schema store selectedNodeId', async () => {
    mockGetModelConnectionId.mockReturnValue('conn-1')
    mockConnectionState.activeConnections = {
      'conn-1': { sessionDatabase: null, profile: { defaultDatabase: '' } },
    }
    mockGetSelectedDatabase.mockReturnValue('schemadb')
    mockGetCache.mockReturnValue({
      status: 'ready',
      routines: {
        schemadb: [{ name: 'tree_func', routineType: 'FUNCTION' }],
      },
    })
    mockGetRoutineParameters.mockResolvedValue({
      parameters: [],
      returnType: 'INT',
    })

    const sql = 'SELECT tree_func('
    const model = mockModel(sql)
    const result = (await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )) as { value: { signatures: Array<{ label: string }> } } | null

    expect(result).not.toBeNull()
    expect(result!.value.signatures[0].label).toContain('tree_func')
    expect(mockGetRoutineParameters).toHaveBeenCalledWith(
      'conn-1',
      'schemadb',
      'tree_func',
      'FUNCTION'
    )
  })

  it('handles getSelectedDatabase returning null gracefully', async () => {
    mockGetModelConnectionId.mockReturnValue('conn-1')
    mockConnectionState.activeConnections = {
      'conn-1': { sessionDatabase: null, profile: {} },
    }
    mockGetSelectedDatabase.mockReturnValue(null)
    mockGetCache.mockReturnValue({ status: 'ready', routines: {} })

    const sql = 'SELECT some_func('
    const model = mockModel(sql)
    const result = await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )

    // Should not throw, just return undefined (no databases to search)
    expect(result).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Tests for qualified CALL, same-name disambiguation, line comments (Fix 1/5)
// ---------------------------------------------------------------------------

describe('provideSignatureHelp — qualified CALL should look up procedure', () => {
  it('CALL mydb.my_proc( returns procedure signature from cache', async () => {
    mockGetModelConnectionId.mockReturnValue('conn-1')
    mockConnectionState.activeConnections = {
      'conn-1': { sessionDatabase: 'testdb', profile: {} },
    }
    mockGetRoutineParameters.mockResolvedValue({
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
    expect(mockGetRoutineParameters).toHaveBeenCalledWith('conn-1', 'mydb', 'my_proc', 'PROCEDURE')
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
    expect(mockGetRoutineParameters).not.toHaveBeenCalled()
  })

  it('CALL abs( prefers stored procedure over built-in', async () => {
    mockGetModelConnectionId.mockReturnValue('conn-1')
    mockConnectionState.activeConnections = {
      'conn-1': { sessionDatabase: 'testdb', profile: {} },
    }
    mockGetCache.mockReturnValue({
      status: 'ready',
      routines: {
        testdb: [{ name: 'abs', routineType: 'PROCEDURE' }],
      },
    })
    mockGetRoutineParameters.mockResolvedValue({
      parameters: [],
      returnType: null,
      routineType: 'PROCEDURE',
    })

    const sql = 'CALL abs('
    const model = mockModel(sql)
    const result = (await capturedProvider.provideSignatureHelp(
      model,
      mockPosition(),
      mockToken(),
      {}
    )) as { value: { signatures: Array<{ label: string }> } } | null

    expect(result).not.toBeNull()
    // Should have looked up procedure, not returned the built-in
    expect(mockGetRoutineParameters).toHaveBeenCalledWith('conn-1', 'testdb', 'abs', 'PROCEDURE')
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
