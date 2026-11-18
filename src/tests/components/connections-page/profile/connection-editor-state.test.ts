import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildErrorResult,
  clearsSavedPassword,
  createIdleEditorState,
  editorStateFor,
  editorWithField,
  formDataToStore,
  getDefaultFormData,
  hasFormErrors,
  hasSavedPasswordAfterUpdate,
  oneOffPassword,
  resolveCurrentConnectionId,
  shouldUseSavedPassword,
  validate,
  validationPatch,
  type ConnectionEditorState,
} from '../../../../components/connections-page/profile/connection-editor-state'
import { useSettingsStore } from '../../../../stores/settings-store'
import type { ConnectionFormData } from '../../../../types/connection'
import { makeSavedConnection } from '../../../helpers/connection-test-utils'

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
    expect(formData.sslMode).toBe('preferred')
  })
})

describe('validate', () => {
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

  it('requires the client certificate and key together', () => {
    expect(validate(validFormData({ sslCertPath: '/c.pem' }))).toEqual({
      sslKeyPath: 'Add the client key that goes with the certificate',
    })
    expect(validate(validFormData({ sslKeyPath: '/k.pem' }))).toEqual({
      sslCertPath: 'Add the client certificate that goes with the key',
    })
    expect(validate(validFormData({ sslCertPath: '/c.pem', sslKeyPath: '/k.pem' }))).toEqual({})
  })
})

describe('validationPatch', () => {
  it('opens every section that has an error', () => {
    expect(validationPatch(validFormData())).toEqual({ errors: {}, sectionsToOpen: [] })
    const patch = validationPatch(validFormData({ name: '', host: '', sslCertPath: '/c.pem' }))
    expect(patch.sectionsToOpen).toEqual(['server', 'security', 'behaviour'])
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
  it('prefers the id saved in this editor, then the edited profile', () => {
    const editingConnection = makeSavedConnection()
    expect(resolveCurrentConnectionId(editorWith({ savedId: 'saved' }), editingConnection)).toBe(
      'saved'
    )
    expect(resolveCurrentConnectionId(editorWith({}), editingConnection)).toBe('conn-1')
    expect(resolveCurrentConnectionId(editorWith({}), undefined)).toBeNull()
  })
})

describe('editorStateFor', () => {
  it('loads an edited connection without its password', () => {
    const editor = editorStateFor(makeSavedConnection(), undefined)
    expect(editor.formData.host).toBe('127.0.0.1')
    expect(editor.formData.password).toBe('')
    expect(editor.savedId).toBe('conn-1')
    expect(editor.hasSavedPassword).toBe(true)

    const seed = { data: validFormData({ host: 'seeded' }), sourceHadPassword: true }
    expect(editorStateFor(undefined, seed).formData.host).toBe('seeded')
  })
})

describe('editorWithField', () => {
  it('sets the field and clears only its error', () => {
    const current = editorWith({ errors: { host: 'Host is required', name: 'required' } })
    const next = editorWithField(current, { field: 'host', value: 'db.local' })
    expect(next.formData.host).toBe('db.local')
    expect(next.errors).toEqual({ name: 'required' })
  })
})

describe('saved password rules', () => {
  it('keeps, replaces, clears or uses a password once from the save-password choice', () => {
    const kept = editorWith({ hasSavedPassword: true })
    expect(shouldUseSavedPassword(kept)).toBe(true)
    expect(hasSavedPasswordAfterUpdate(kept)).toBe(true)
    expect(clearsSavedPassword(kept)).toBe(false)
    expect(oneOffPassword(kept)).toBeUndefined()

    const typed = editorWith({ formData: validFormData({ password: 'secret' }) })
    expect(shouldUseSavedPassword(typed)).toBe(false)
    expect(hasSavedPasswordAfterUpdate(typed)).toBe(true)
    expect(formDataToStore(typed).password).toBe('secret')

    const notSaved = editorWith({
      hasSavedPassword: true,
      savePassword: false,
      formData: validFormData({ password: 'once' }),
    })
    expect(clearsSavedPassword(notSaved)).toBe(true)
    expect(hasSavedPasswordAfterUpdate(notSaved)).toBe(false)
    expect(formDataToStore(notSaved).password).toBe('')
    expect(oneOffPassword(notSaved)).toBe('once')
    expect(oneOffPassword(editorWith({ savePassword: false }))).toBeUndefined()
  })
})
