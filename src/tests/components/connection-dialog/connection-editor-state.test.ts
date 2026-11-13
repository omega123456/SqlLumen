import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildErrorResult,
  createIdleEditorState,
  deletedEditorState,
  editorStateFor,
  editorWithField,
  getDefaultFormData,
  hasFormErrors,
  hasSavedPasswordAfterUpdate,
  resolveCurrentConnectionId,
  shouldUseSavedPassword,
  tabHasError,
  validate,
  validationPatch,
  type ConnectionEditorState,
} from '../../../components/connection-dialog/connection-editor-state'
import { useSettingsStore } from '../../../stores/settings-store'
import type { ConnectionFormData, SavedConnection } from '../../../types/connection'

function makeSavedConnection(overrides: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id: 'conn-1',
    name: 'Test DB',
    host: '127.0.0.1',
    port: 3306,
    username: 'root',
    hasPassword: true,
    defaultDatabase: 'mydb',
    sslEnabled: false,
    sslCaPath: null,
    sslCertPath: null,
    sslKeyPath: null,
    color: null,
    groupId: null,
    readOnly: false,
    sortOrder: 0,
    connectTimeoutSecs: 10,
    keepaliveIntervalSecs: 30,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function validFormData(overrides: Partial<ConnectionFormData> = {}): ConnectionFormData {
  return {
    ...getDefaultFormData(),
    name: 'Local',
    host: 'localhost',
    username: 'root',
    ...overrides,
  }
}

function editorWith(overrides: Partial<ConnectionEditorState>): ConnectionEditorState {
  return { ...createIdleEditorState(), ...overrides }
}

beforeEach(() => {
  useSettingsStore.setState({ settings: {}, pendingChanges: {} })
})

describe('getDefaultFormData', () => {
  it('reads timeouts from settings and falls back to defaults when unparseable', () => {
    useSettingsStore.setState({
      settings: { 'connection.defaultTimeout': '25', 'connection.defaultKeepalive': 'bogus' },
    })
    const formData = getDefaultFormData()
    expect(formData.connectTimeoutSecs).toBe(25)
    expect(formData.keepaliveIntervalSecs).toBe(60)
    expect(formData.port).toBe(3306)
  })
})

describe('validate', () => {
  it('accepts a complete form', () => {
    expect(validate(validFormData())).toEqual({})
  })

  it('reports every invalid field', () => {
    const errors = validate(
      validFormData({
        name: ' ',
        host: '',
        username: '',
        port: 0,
        connectTimeoutSecs: 0,
        keepaliveIntervalSecs: -1,
      })
    )
    expect(Object.keys(errors).sort()).toEqual([
      'connectTimeoutSecs',
      'host',
      'keepaliveIntervalSecs',
      'name',
      'port',
      'username',
    ])
    expect(hasFormErrors(errors)).toBe(true)
  })
})

describe('validationPatch', () => {
  it('only patches errors when the form is valid', () => {
    expect(validationPatch(validFormData())).toEqual({ errors: {} })
  })

  it('switches to the first tab with an error', () => {
    const patch = validationPatch(validFormData({ connectTimeoutSecs: 0 }))
    expect(patch.activeTab).toBe('advanced')
    expect(tabHasError(patch.errors, 'advanced')).toBe(true)
    expect(tabHasError(patch.errors, 'general')).toBe(false)
  })
})

describe('buildErrorResult', () => {
  it('wraps the error message in a failed test result', () => {
    expect(buildErrorResult(new Error('boom'))).toEqual({
      success: false,
      serverVersion: null,
      authMethod: null,
      sslStatus: null,
      connectionTimeMs: null,
      errorMessage: 'boom',
    })
  })
})

describe('resolveCurrentConnectionId', () => {
  it('prefers the saved id, then the editing id unless it was deleted', () => {
    const editingConnection = makeSavedConnection()
    expect(
      resolveCurrentConnectionId({
        savedId: 'saved',
        editingConnection: editingConnection,
        deletedConnectionId: null,
      })
    ).toBe('saved')
    expect(
      resolveCurrentConnectionId({
        savedId: null,
        editingConnection: editingConnection,
        deletedConnectionId: null,
      })
    ).toBe('conn-1')
    expect(
      resolveCurrentConnectionId({
        savedId: null,
        editingConnection: editingConnection,
        deletedConnectionId: 'conn-1',
      })
    ).toBeNull()
    expect(
      resolveCurrentConnectionId({
        savedId: null,
        editingConnection: undefined,
        deletedConnectionId: null,
      })
    ).toBeNull()
  })
})

describe('editorStateFor', () => {
  it('loads an edited connection without its password', () => {
    const editor = editorStateFor(makeSavedConnection(), undefined)
    expect(editor.formData.host).toBe('127.0.0.1')
    expect(editor.formData.password).toBe('')
    expect(editor.savedId).toBe('conn-1')
    expect(editor.hasSavedPassword).toBe(true)
  })

  it('copies a duplicate seed', () => {
    const seed = { data: validFormData({ name: 'Copy' }), sourceHadPassword: true, key: 1 }
    const editor = editorStateFor(undefined, seed)
    expect(editor.formData.name).toBe('Copy')
    expect(editor.formData).not.toBe(seed.data)
  })

  it('falls back to defaults', () => {
    expect(editorStateFor(undefined, undefined).formData.name).toBe('')
  })
})

describe('deletedEditorState', () => {
  it('resets the editor but keeps the active tab and remembers the deleted id', () => {
    const current = editorWith({ activeTab: 'ssl', savedId: 'conn-1' })
    const deleted = deletedEditorState(current, 'conn-1')
    expect(deleted.activeTab).toBe('ssl')
    expect(deleted.savedId).toBeNull()
    expect(deleted.deletedConnectionId).toBe('conn-1')
  })
})

describe('editorWithField', () => {
  it('sets the field and clears only its error', () => {
    const current = editorWith({ errors: { host: 'Host is required', name: 'required' } })
    const next = editorWithField(current, { field: 'host', value: 'db.local' })
    expect(next.formData.host).toBe('db.local')
    expect(next.errors).toEqual({ name: 'required' })
  })

  it('keeps the same errors object when the field had no error', () => {
    const current = editorWith({ errors: { name: 'required' } })
    const next = editorWithField(current, { field: 'host', value: 'db.local' })
    expect(next.errors).toBe(current.errors)
  })
})

describe('saved password rules', () => {
  it('uses the saved password only when kept and nothing new was typed', () => {
    expect(shouldUseSavedPassword(editorWith({ hasSavedPassword: true }))).toBe(true)
    expect(
      shouldUseSavedPassword(editorWith({ hasSavedPassword: true, clearSavedPassword: true }))
    ).toBe(false)
    const typedPassword = editorWith({
      hasSavedPassword: true,
      formData: validFormData({ password: 'secret' }),
    })
    expect(shouldUseSavedPassword(typedPassword)).toBe(false)
  })

  it('tracks whether a password remains saved after an update', () => {
    expect(hasSavedPasswordAfterUpdate(editorWith({ clearSavedPassword: true }))).toBe(false)
    expect(hasSavedPasswordAfterUpdate(editorWith({ hasSavedPassword: true }))).toBe(true)
    const typedPassword = editorWith({ formData: validFormData({ password: 'secret' }) })
    expect(hasSavedPasswordAfterUpdate(typedPassword)).toBe(true)
    expect(hasSavedPasswordAfterUpdate(editorWith({}))).toBe(false)
  })
})
