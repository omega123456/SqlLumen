import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from '@testing-library/react'
import { editor } from 'monaco-editor'
import type { Uri } from 'monaco-editor'
import {
  registerModelConnection,
  resetModelConnections,
} from '../../../../components/query-editor/completion-service'
import {
  _clearAllCaches,
  hydrateFromSnapshot,
  invalidateCache,
} from '../../../../components/query-editor/schema-metadata-cache'
import {
  SCHEMA_MARKER_OWNER,
  SchemaProblemReporter,
} from '../../../../components/query-editor/semantic-highlighting/schema-problem-reporter'
import { isSemanticHighlightingApplied } from '../../../../components/query-editor/semantic-highlighting/semantic-highlighting-status'
import {
  MySqlSemanticTokensProvider,
  SEMANTIC_HIGHLIGHTING_MAX_LENGTH,
} from '../../../../components/query-editor/semantic-highlighting/semantic-tokens-provider'
import { useConnectionStore } from '../../../../stores/connection-store'
import { makeNodeId, useSchemaStore } from '../../../../stores/schema-store'
import { EditorMySQLParser } from '../../../../workers/editor-mysql-parser'
import { classifySqlIdentifiers } from '../../../../workers/sql-identifier-classifier'

const CONNECTION_ID = 'conn-1'

const SCHEMA_SNAPSHOT = JSON.stringify({
  databases: ['shop', 'analytics'],
  tables: {
    shop: [{ name: 'users', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 1, dataSize: 1 }],
    analytics: [{ name: 'events', engine: 'InnoDB', charset: 'utf8mb4', rowCount: 1, dataSize: 1 }],
  },
  views: {},
  columns: { 'shop.users': [{ name: 'email', dataType: 'VARCHAR' }] },
  routines: {},
  triggers: {},
  foreignKeys: {},
  indexes: {},
})

let modelCounter = 0

interface FakeModel {
  uri: Uri
  model: editor.ITextModel
  dispose: () => void
}

const MODEL_VERSION_ID = 3

function createModel(content: string): FakeModel {
  modelCounter += 1
  const uriText = `inmemory://model/${modelCounter}`
  let disposed = false
  const uri = { toString: () => uriText } as unknown as Uri
  const model = {
    uri: uri,
    getValue: () => content,
    getValueLength: () => content.length,
    getVersionId: () => MODEL_VERSION_ID,
    isDisposed: () => disposed,
  } as unknown as editor.ITextModel
  return { uri: uri, model: model, dispose: () => (disposed = true) }
}

function isHighlighted(fakeModel: FakeModel): boolean {
  return isSemanticHighlightingApplied({
    uri: fakeModel.uri.toString(),
    versionId: MODEL_VERSION_ID,
  })
}

function createProvider(): MySqlSemanticTokensProvider {
  const parser = new EditorMySQLParser()
  const classifier = {
    classifyIdentifiers: async (code: string) => classifySqlIdentifiers(parser, code),
  }
  return new MySqlSemanticTokensProvider(async () => classifier, new SchemaProblemReporter())
}

function setSessionDatabase(database: string | null): void {
  act(() => {
    useConnectionStore.setState({
      activeConnections: {
        [CONNECTION_ID]: { sessionDatabase: database, profile: { defaultDatabase: null } },
      },
    } as never)
  })
}

function latestMarkers(model: editor.ITextModel): editor.IMarkerData[] {
  const markerCalls = vi
    .mocked(editor.setModelMarkers)
    .mock.calls.filter((call) => call[0] === model && call[1] === SCHEMA_MARKER_OWNER)
  const latestCall = markerCalls[markerCalls.length - 1]
  return latestCall ? latestCall[2] : []
}

function markerMessages(model: editor.ITextModel): string[] {
  return latestMarkers(model).map((marker) => marker.message)
}

function connectModel(fakeModel: FakeModel): void {
  registerModelConnection({ uri: fakeModel.uri.toString(), connectionId: CONNECTION_ID })
}

let provider: MySqlSemanticTokensProvider

beforeEach(() => {
  vi.mocked(editor.setModelMarkers).mockClear()
  vi.mocked(editor.onWillDisposeModel).mockClear()
  setSessionDatabase('shop')
  provider = createProvider()
})

afterEach(() => {
  provider.dispose()
  resetModelConnections()
  _clearAllCaches()
})

describe('MySqlSemanticTokensProvider', () => {
  it('encodes the identifiers of every statement', async () => {
    const fakeModel = createModel('SELECT u.email FROM users u;\nSELECT 1')

    const tokens = await provider.provideDocumentSemanticTokens(fakeModel.model)

    expect(Array.from(tokens?.data ?? [])).toEqual([
      ...[0, 7, 1, 2, 0],
      ...[0, 2, 5, 3, 0],
      ...[0, 11, 5, 1, 0],
      ...[0, 6, 1, 2, 0],
    ])
    expect(provider.getLegend().tokenTypes).toContain('tableAlias')
  })

  it('marks the model as highlighted once tokens are provided', async () => {
    const fakeModel = createModel('SELECT 1')

    expect(isHighlighted(fakeModel)).toBe(false)
    await provider.provideDocumentSemanticTokens(fakeModel.model)

    expect(isHighlighted(fakeModel)).toBe(true)
  })

  it('sets warning markers for unknown tables and columns', async () => {
    hydrateFromSnapshot(SCHEMA_SNAPSHOT, CONNECTION_ID)
    const fakeModel = createModel('SELECT u.emial FROM users u JOIN ordrs o ON 1 = 1')
    connectModel(fakeModel)

    await provider.provideDocumentSemanticTokens(fakeModel.model)

    expect(latestMarkers(fakeModel.model)).toEqual([
      {
        severity: 4,
        message: 'Unknown table `shop.ordrs`',
        startLineNumber: 1,
        startColumn: 34,
        endLineNumber: 1,
        endColumn: 39,
      },
      {
        severity: 4,
        message: 'Unknown column `emial` in `users`',
        startLineNumber: 1,
        startColumn: 10,
        endLineNumber: 1,
        endColumn: 15,
      },
    ])
  })

  it('sets no markers for a model without a connection', async () => {
    hydrateFromSnapshot(SCHEMA_SNAPSHOT, CONNECTION_ID)
    const fakeModel = createModel('SELECT * FROM ordrs')

    await provider.provideDocumentSemanticTokens(fakeModel.model)

    expect(markerMessages(fakeModel.model)).toEqual([])
  })

  it('sets no markers until the schema cache is ready', async () => {
    const fakeModel = createModel('SELECT * FROM ordrs')
    connectModel(fakeModel)

    await provider.provideDocumentSemanticTokens(fakeModel.model)

    expect(markerMessages(fakeModel.model)).toEqual([])
  })

  it('refreshes markers when the schema cache loads and when it is invalidated', async () => {
    const fakeModel = createModel('SELECT * FROM ordrs')
    connectModel(fakeModel)
    await provider.provideDocumentSemanticTokens(fakeModel.model)

    hydrateFromSnapshot(SCHEMA_SNAPSHOT, CONNECTION_ID)
    expect(markerMessages(fakeModel.model)).toEqual(['Unknown table `shop.ordrs`'])

    invalidateCache(CONNECTION_ID)
    expect(markerMessages(fakeModel.model)).toEqual([])
  })

  it('refreshes markers when the model connection registers', async () => {
    hydrateFromSnapshot(SCHEMA_SNAPSHOT, CONNECTION_ID)
    const fakeModel = createModel('SELECT * FROM ordrs')
    await provider.provideDocumentSemanticTokens(fakeModel.model)

    connectModel(fakeModel)

    expect(markerMessages(fakeModel.model)).toEqual(['Unknown table `shop.ordrs`'])
  })

  it('refreshes markers when the active database changes', async () => {
    hydrateFromSnapshot(SCHEMA_SNAPSHOT, CONNECTION_ID)
    const fakeModel = createModel('SELECT * FROM events')
    connectModel(fakeModel)
    await provider.provideDocumentSemanticTokens(fakeModel.model)
    expect(markerMessages(fakeModel.model)).toEqual(['Unknown table `shop.events`'])

    setSessionDatabase('analytics')

    expect(markerMessages(fakeModel.model)).toEqual([])
  })

  it('refreshes markers when the object browser selects another database', async () => {
    hydrateFromSnapshot(SCHEMA_SNAPSHOT, CONNECTION_ID)
    setSessionDatabase(null)
    const fakeModel = createModel('SELECT * FROM users')
    connectModel(fakeModel)
    await provider.provideDocumentSemanticTokens(fakeModel.model)
    expect(markerMessages(fakeModel.model)).toEqual([])

    act(() => {
      useSchemaStore.setState({
        connectionStates: {
          [CONNECTION_ID]: { selectedNodeId: makeNodeId('database', 'analytics', 'analytics') },
        },
      } as never)
    })

    expect(markerMessages(fakeModel.model)).toEqual(['Unknown table `analytics.users`'])
    act(() => useSchemaStore.setState({ connectionStates: {} } as never))
  })

  it('leaves markers alone when an unrelated store change keeps the context', async () => {
    hydrateFromSnapshot(SCHEMA_SNAPSHOT, CONNECTION_ID)
    const fakeModel = createModel('SELECT * FROM ordrs')
    connectModel(fakeModel)
    await provider.provideDocumentSemanticTokens(fakeModel.model)
    const markerCallCount = vi.mocked(editor.setModelMarkers).mock.calls.length

    setSessionDatabase('shop')

    expect(vi.mocked(editor.setModelMarkers).mock.calls).toHaveLength(markerCallCount)
  })

  it('skips documents above the length cap and clears their markers', async () => {
    hydrateFromSnapshot(SCHEMA_SNAPSHOT, CONNECTION_ID)
    const longStatement = `SELECT * FROM ordrs WHERE note = '${'x'.repeat(SEMANTIC_HIGHLIGHTING_MAX_LENGTH)}'`
    const fakeModel = createModel(longStatement)
    connectModel(fakeModel)

    const tokens = await provider.provideDocumentSemanticTokens(fakeModel.model)

    expect(tokens).toBeNull()
    expect(markerMessages(fakeModel.model)).toEqual([])
    expect(vi.mocked(editor.setModelMarkers)).toHaveBeenCalledWith(
      fakeModel.model,
      SCHEMA_MARKER_OWNER,
      []
    )
    expect(isHighlighted(fakeModel)).toBe(true)
  })

  it('returns nothing for a model disposed while the worker classified it', async () => {
    const fakeModel = createModel('SELECT * FROM users')
    const pendingTokens = provider.provideDocumentSemanticTokens(fakeModel.model)
    fakeModel.dispose()

    expect(await pendingTokens).toBeNull()
    expect(vi.mocked(editor.setModelMarkers)).not.toHaveBeenCalled()
  })

  it('clears markers and highlighting status when a model is disposed', async () => {
    hydrateFromSnapshot(SCHEMA_SNAPSHOT, CONNECTION_ID)
    const fakeModel = createModel('SELECT * FROM ordrs')
    connectModel(fakeModel)
    await provider.provideDocumentSemanticTokens(fakeModel.model)
    const releaseModel = vi.mocked(editor.onWillDisposeModel).mock.calls[0][0]

    releaseModel(fakeModel.model)

    expect(markerMessages(fakeModel.model)).toEqual([])
    expect(isHighlighted(fakeModel)).toBe(false)
    invalidateCache(CONNECTION_ID)
    expect(markerMessages(fakeModel.model)).toEqual([])
  })

  it('stops listening for context changes once disposed', async () => {
    const fakeModel = createModel('SELECT * FROM ordrs')
    connectModel(fakeModel)
    await provider.provideDocumentSemanticTokens(fakeModel.model)

    provider.dispose()
    hydrateFromSnapshot(SCHEMA_SNAPSHOT, CONNECTION_ID)

    expect(markerMessages(fakeModel.model)).toEqual([])
  })

  it('keeps no per-document state to release', () => {
    expect(provider.releaseDocumentSemanticTokens()).toBeUndefined()
  })
})
