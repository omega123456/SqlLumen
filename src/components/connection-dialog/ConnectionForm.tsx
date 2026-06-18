import { useState, useEffect, useMemo, useRef } from 'react'
import { Database, Eye, EyeSlash, FolderOpen } from '@phosphor-icons/react'
import { open } from '@tauri-apps/plugin-dialog'
import { useConnectionStore } from '../../stores/connection-store'
import { useSettingsStore } from '../../stores/settings-store'
import { showErrorToast, showSuccessToast } from '../../stores/toast-store'
import {
  deleteConnection,
  testConnection,
  saveConnection as saveConnectionIPC,
  updateConnection,
} from '../../lib/connection-commands'
import { Button } from '../common/Button'
import { TextInput } from '../common/TextInput'
import { Checkbox } from '../common/Checkbox'
import { Dropdown } from '../common/Dropdown'
import { ElevatedSurface } from '../common/ElevatedSurface'
import { UnderlineTabBar, UnderlineTab } from '../common/UnderlineTabs'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { ColorPickerPopover } from './ColorPickerPopover'
import { TestConnectionResult } from './TestConnectionResult'
import type {
  ConnectionFormData,
  SavedConnection,
  TestConnectionResult as TestConnectionResultType,
} from '../../types/connection'
import styles from './ConnectionForm.module.css'

export interface ConnectionFormSeed {
  data: ConnectionFormData
  sourceHadPassword: boolean
  key: number
}

interface ConnectionFormProps {
  editingConnection?: SavedConnection
  onDeleteConnection?: (id: string) => void
  /** Prefill the form as a new, unsaved connection (used by Duplicate). */
  initialData?: ConnectionFormSeed
}

type FormTab = 'general' | 'ssl' | 'advanced'

const TAB_ORDER: FormTab[] = ['general', 'ssl', 'advanced']

const TAB_LABELS: Record<FormTab, string> = {
  general: 'General',
  ssl: 'SSL',
  advanced: 'Advanced',
}

const ACCESS_MODE_OPTIONS = [
  { value: 'rw', label: 'Allow writes (read-write)' },
  { value: 'ro', label: 'Read-only (block writes)' },
]

const FIELD_TAB: Record<string, FormTab> = {
  name: 'general',
  host: 'general',
  port: 'general',
  username: 'general',
  connectTimeoutSecs: 'advanced',
  keepaliveIntervalSecs: 'advanced',
}

function firstTabWithError(errors: FormErrors): FormTab | null {
  const errorTabs = new Set(Object.keys(errors).map((field) => FIELD_TAB[field] ?? 'general'))
  return TAB_ORDER.find((tab) => errorTabs.has(tab)) ?? null
}

/** Build default form data, reading connection defaults from settings store. */
function getDefaultFormData(): ConnectionFormData {
  const settingsState = useSettingsStore.getState()
  const timeout = parseInt(settingsState.getSetting('connection.defaultTimeout'), 10)
  const keepalive = parseInt(settingsState.getSetting('connection.defaultKeepalive'), 10)
  return {
    name: '',
    host: '',
    port: 3306,
    username: '',
    password: '',
    defaultDatabase: null,
    sslEnabled: false,
    sslCaPath: null,
    sslCertPath: null,
    sslKeyPath: null,
    color: null,
    groupId: null,
    readOnly: false,
    connectTimeoutSecs: isNaN(timeout) ? 10 : timeout,
    keepaliveIntervalSecs: isNaN(keepalive) ? 60 : keepalive,
  }
}

interface FormErrors {
  [key: string]: string
}

function validate(data: ConnectionFormData): FormErrors {
  const errors: FormErrors = {}
  if (!data.name.trim()) {
    errors.name = 'Connection name is required'
  }
  if (!data.host.trim()) {
    errors.host = 'Host is required'
  }
  if (!data.username.trim()) {
    errors.username = 'Username is required'
  }
  if (!data.port || data.port < 1 || data.port > 65535) {
    errors.port = 'Port must be between 1 and 65535'
  }
  if (data.connectTimeoutSecs < 1) {
    errors.connectTimeoutSecs = 'Connect timeout must be at least 1 second'
  }
  if (data.keepaliveIntervalSecs < 0) {
    errors.keepaliveIntervalSecs = 'Keepalive interval cannot be negative'
  }
  return errors
}

/** Build a failure TestConnectionResult from a caught error. */
function buildErrorResult(err: unknown): TestConnectionResultType {
  return {
    success: false,
    serverVersion: null,
    authMethod: null,
    sslStatus: null,
    connectionTimeMs: null,
    errorMessage: err instanceof Error ? err.message : String(err),
  }
}

interface SslFileFieldProps {
  id: string
  label: string
  value: string
  onChange: (val: string) => void
  onBrowse: () => void
  disabled: boolean
  browseLabel: string
  placeholder?: string
}

function SslFileField({
  id,
  label,
  value,
  onChange,
  onBrowse,
  disabled,
  browseLabel,
  placeholder,
}: SslFileFieldProps) {
  return (
    <div className={styles.fieldGroup}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.fileInputRow}>
        <TextInput
          type="text"
          id={id}
          variant="mono"
          className={styles.fileInputRowField}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
        />
        <button
          type="button"
          className={styles.browseButton}
          onClick={onBrowse}
          disabled={disabled}
          aria-label={browseLabel}
        >
          <FolderOpen size={16} />
        </button>
      </div>
    </div>
  )
}

export function ConnectionForm({
  editingConnection,
  onDeleteConnection,
  initialData,
}: ConnectionFormProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const nameAutoFocusRef = useRef(true)
  const [formData, setFormData] = useState<ConnectionFormData>(getDefaultFormData)
  const [errors, setErrors] = useState<FormErrors>({})
  const [activeTab, setActiveTab] = useState<FormTab>('general')
  const [showPassword, setShowPassword] = useState(false)
  const [hasSavedPassword, setHasSavedPassword] = useState(false)
  const [clearSavedPassword, setClearSavedPassword] = useState(false)
  const [testResult, setTestResult] = useState<TestConnectionResultType | null>(null)
  const [pendingAction, setPendingAction] = useState<'test' | 'save' | 'connect' | 'delete' | null>(
    null
  )
  const [savedId, setSavedId] = useState<string | null>(null)
  const [deletedConnectionId, setDeletedConnectionId] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteConfirmError, setDeleteConfirmError] = useState<string | null>(null)
  const [dialogPortalRoot, setDialogPortalRoot] = useState<HTMLElement | null>(null)

  const connectionGroups = useConnectionStore((s) => s.connectionGroups)
  const fetchSavedConnections = useConnectionStore((s) => s.fetchSavedConnections)
  const groupDropdownOptions = useMemo(
    () => [
      { value: '', label: 'Ungrouped' },
      ...connectionGroups.map((g) => ({ value: g.id, label: g.name })),
    ],
    [connectionGroups]
  )
  const openConnection = useConnectionStore((s) => s.openConnection)
  const closeDialog = useConnectionStore((s) => s.closeDialog)

  useEffect(() => {
    const dialog = rootRef.current?.closest('dialog')
    if (dialog instanceof HTMLDialogElement) {
      setDialogPortalRoot(dialog)
      return
    }
    setDialogPortalRoot(null)
  }, [])

  // Populate form when editingConnection or the duplicate seed changes.
  // Precedence: editing > duplicate seed > defaults.
  useEffect(() => {
    if (editingConnection) {
      setDeletedConnectionId(null)
      setFormData({
        name: editingConnection.name,
        host: editingConnection.host,
        port: editingConnection.port,
        username: editingConnection.username,
        password: '',
        defaultDatabase: editingConnection.defaultDatabase,
        sslEnabled: editingConnection.sslEnabled,
        sslCaPath: editingConnection.sslCaPath,
        sslCertPath: editingConnection.sslCertPath,
        sslKeyPath: editingConnection.sslKeyPath,
        color: editingConnection.color,
        groupId: editingConnection.groupId,
        readOnly: editingConnection.readOnly,
        connectTimeoutSecs: editingConnection.connectTimeoutSecs,
        keepaliveIntervalSecs: editingConnection.keepaliveIntervalSecs,
      })
      setSavedId(editingConnection.id)
      setHasSavedPassword(editingConnection.hasPassword)
      setClearSavedPassword(false)
      setDeleteConfirmOpen(false)
      setDeleteConfirmError(null)
    } else {
      setFormData(initialData ? { ...initialData.data } : getDefaultFormData())
      setSavedId(null)
      setHasSavedPassword(false)
      setClearSavedPassword(false)
      setDeletedConnectionId(null)
      setDeleteConfirmOpen(false)
      setDeleteConfirmError(null)
    }
    setErrors({})
    setTestResult(null)
    setActiveTab('general')
  }, [editingConnection, initialData])

  useEffect(() => {
    nameAutoFocusRef.current = false
  }, [])

  const updateField = <K extends keyof ConnectionFormData>(
    field: K,
    value: ConnectionFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }

  const handleBrowseFile = async (field: 'sslCaPath' | 'sslCertPath' | 'sslKeyPath') => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Certificates', extensions: ['pem', 'crt', 'key'] }],
      })
      if (typeof selected === 'string') {
        updateField(field, selected)
      }
    } catch {
      // User cancelled or error — ignore
    }
  }

  const isAnyPending = pendingAction !== null
  const currentConnectionId =
    savedId ??
    (editingConnection && editingConnection.id !== deletedConnectionId
      ? editingConnection.id
      : null)

  function runValidation(): boolean {
    const errs = validate(formData)
    setErrors(errs)
    const errorTab = firstTabWithError(errs)
    if (errorTab) {
      setActiveTab(errorTab)
      return false
    }
    return true
  }

  const tabHasError = (tab: FormTab): boolean =>
    Object.keys(errors).some((field) => (FIELD_TAB[field] ?? 'general') === tab)

  const handleTestConnection = async () => {
    if (!runValidation()) {
      return
    }

    setPendingAction('test')
    setTestResult(null)
    try {
      // Use the saved keychain password only when none was freshly typed and the
      // user isn't explicitly clearing it.
      const useSavedPassword = hasSavedPassword && !clearSavedPassword && formData.password === ''
      const result = await testConnection(formData, useSavedPassword ? currentConnectionId : null)
      setTestResult(result)
    } catch (err) {
      const failure = buildErrorResult(err)
      setTestResult(failure)
      showErrorToast('Connection test failed', failure.errorMessage ?? undefined)
    } finally {
      setPendingAction(null)
    }
  }

  const handleSave = async () => {
    if (!runValidation()) {
      return
    }

    setPendingAction('save')
    try {
      const existingId = savedId ?? editingConnection?.id
      if (existingId) {
        await updateConnection(existingId, formData, { clearPassword: clearSavedPassword })
        setHasSavedPassword(
          clearSavedPassword ? false : hasSavedPassword || formData.password !== ''
        )
      } else {
        const newId = await saveConnectionIPC(formData)
        setSavedId(newId)
        setHasSavedPassword(formData.password !== '')
      }
      setClearSavedPassword(false)
      await fetchSavedConnections()
      showSuccessToast('Connection saved', formData.name.trim() || undefined)
    } catch (err) {
      const failure = buildErrorResult(err)
      setTestResult(failure)
      showErrorToast('Failed to save connection', failure.errorMessage ?? undefined)
    } finally {
      setPendingAction(null)
    }
  }

  const handleConnect = async () => {
    if (!runValidation()) {
      return
    }

    setPendingAction('connect')
    let connectionId = savedId ?? editingConnection?.id
    try {
      if (connectionId) {
        await updateConnection(connectionId, formData, { clearPassword: clearSavedPassword })
        setHasSavedPassword(
          clearSavedPassword ? false : hasSavedPassword || formData.password !== ''
        )
        await fetchSavedConnections()
      } else {
        connectionId = await saveConnectionIPC(formData)
        setSavedId(connectionId)
        setHasSavedPassword(formData.password !== '')
        await fetchSavedConnections()
      }
      setClearSavedPassword(false)
    } catch (err) {
      const failure = buildErrorResult(err)
      setTestResult(failure)
      showErrorToast('Failed to save connection', failure.errorMessage ?? undefined)
      setPendingAction(null)
      return
    }

    try {
      await openConnection(connectionId!)
      closeDialog()
    } catch (err) {
      const failure = buildErrorResult(err)
      setTestResult(failure)
      /* openConnection already shows an error toast */
    } finally {
      setPendingAction(null)
    }
  }

  const handleDelete = async () => {
    if (!currentConnectionId) {
      return
    }

    setPendingAction('delete')
    setDeleteConfirmError(null)
    try {
      await deleteConnection(currentConnectionId)
      await fetchSavedConnections()
      setFormData(getDefaultFormData())
      setErrors({})
      setTestResult(null)
      setSavedId(null)
      setHasSavedPassword(false)
      setClearSavedPassword(false)
      setDeletedConnectionId(currentConnectionId)
      setDeleteConfirmOpen(false)
      onDeleteConnection?.(currentConnectionId)
      showSuccessToast('Connection deleted')
    } catch (err) {
      const failure = buildErrorResult(err)
      setTestResult(failure)
      setDeleteConfirmError(failure.errorMessage ?? 'Failed to delete connection')
      showErrorToast('Failed to delete connection', failure.errorMessage ?? undefined)
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <div ref={rootRef} className={styles.formGridRoot}>
      <div className={styles.formMain} data-testid="connection-form-main">
        <header className={styles.formHeader} data-testid="connection-form-header">
          <span
            className={styles.formHeaderDot}
            style={{ background: formData.color ?? 'var(--outline-variant)' }}
            aria-hidden
          />
          <div className={styles.formHeaderText}>
            <h3 className={styles.formHeaderName}>
              {formData.name.trim() || formData.host.trim() || 'New Connection'}
            </h3>
            <span className={styles.formHeaderMeta}>
              {formData.host.trim()
                ? `${formData.username.trim() ? `${formData.username.trim()}@` : ''}${formData.host.trim()}:${formData.port}`
                : 'Configure the parameters for your MySQL instance.'}
            </span>
          </div>
        </header>
        <ElevatedSurface className={styles.resultCard}>
          <div className={styles.testResultSlot}>
            <TestConnectionResult result={testResult} />
          </div>
        </ElevatedSurface>
        <ElevatedSurface>
          <form
            className={styles.formInner}
            autoComplete="off"
            onSubmit={(e) => {
              e.preventDefault()
            }}
          >
            <UnderlineTabBar className={styles.formTabBar} data-testid="connection-form-tabs">
              {TAB_ORDER.map((tab) => (
                <UnderlineTab
                  key={tab}
                  active={activeTab === tab}
                  onClick={() => setActiveTab(tab)}
                  data-testid={`connection-form-tab-${tab}`}
                >
                  {TAB_LABELS[tab]}
                  {tabHasError(tab) && (
                    <span className={styles.tabErrorDot} aria-label="Has errors" />
                  )}
                </UnderlineTab>
              ))}
            </UnderlineTabBar>

            {activeTab === 'general' && (
              <div
                className={styles.tabPanel}
                role="tabpanel"
                data-testid="connection-form-panel-general"
              >
                <div className={styles.fieldGroup}>
                  <label htmlFor="conn-name" className={styles.labelCaps}>
                    Connection name
                  </label>
                  <TextInput
                    id="conn-name"
                    type="text"
                    variant="mono"
                    invalid={!!errors.name}
                    value={formData.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    placeholder="My production server"
                    autoFocus={nameAutoFocusRef.current}
                  />
                  {errors.name && <span className={styles.errorText}>{errors.name}</span>}
                </div>

                <div className={styles.row2}>
                  <div className={styles.fieldGroup}>
                    <label htmlFor="conn-host" className={styles.labelCaps}>
                      Host address
                    </label>
                    <TextInput
                      id="conn-host"
                      type="text"
                      variant="mono"
                      invalid={!!errors.host}
                      value={formData.host}
                      onChange={(e) => updateField('host', e.target.value)}
                      placeholder="localhost"
                    />
                    {errors.host && <span className={styles.errorText}>{errors.host}</span>}
                  </div>
                  <div className={styles.fieldGroup}>
                    <label htmlFor="conn-port" className={styles.labelCaps}>
                      Port
                    </label>
                    <TextInput
                      id="conn-port"
                      type="number"
                      variant="mono"
                      invalid={!!errors.port}
                      value={formData.port}
                      onChange={(e) => updateField('port', parseInt(e.target.value, 10) || 0)}
                      min={1}
                      max={65535}
                      placeholder="3306"
                    />
                    {errors.port && <span className={styles.errorText}>{errors.port}</span>}
                  </div>
                </div>

                <div className={styles.rowUserPass}>
                  <div className={styles.fieldGroup}>
                    <label htmlFor="conn-username" className={styles.labelCaps}>
                      Username
                    </label>
                    <TextInput
                      id="conn-username"
                      type="text"
                      variant="mono"
                      invalid={!!errors.username}
                      value={formData.username}
                      onChange={(e) => updateField('username', e.target.value)}
                      placeholder="root"
                    />
                    {errors.username && <span className={styles.errorText}>{errors.username}</span>}
                  </div>
                  <div className={styles.fieldGroup}>
                    <label htmlFor="conn-password" className={styles.labelCaps}>
                      Password
                    </label>
                    <div className={styles.passwordWrapper}>
                      <TextInput
                        id="conn-password"
                        type={showPassword ? 'text' : 'password'}
                        variant="mono"
                        passwordToggleGutter
                        value={formData.password}
                        onChange={(e) => {
                          updateField('password', e.target.value)
                          if (clearSavedPassword) {
                            setClearSavedPassword(false)
                          }
                        }}
                        placeholder={hasSavedPassword && !clearSavedPassword ? '••••••••' : ''}
                        disabled={clearSavedPassword}
                      />
                      <button
                        type="button"
                        className={styles.passwordToggle}
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    {!editingConnection && savedId === null && initialData?.sourceHadPassword && (
                      <span className={styles.fieldHint} data-testid="duplicate-password-hint">
                        Password is not copied — enter it to save.
                      </span>
                    )}
                    {hasSavedPassword && (
                      <label className={styles.label}>
                        <Checkbox
                          checked={clearSavedPassword}
                          onChange={(e) => {
                            const checked = e.target.checked
                            setClearSavedPassword(checked)
                            if (checked && formData.password) {
                              updateField('password', '')
                            }
                          }}
                        />{' '}
                        Use no password (remove saved password)
                      </label>
                    )}
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <label htmlFor="conn-database" className={styles.labelCaps}>
                    Default Database
                  </label>
                  <TextInput
                    id="conn-database"
                    type="text"
                    variant="mono"
                    value={formData.defaultDatabase ?? ''}
                    onChange={(e) => updateField('defaultDatabase', e.target.value || null)}
                    placeholder="mydb"
                  />
                </div>
              </div>
            )}

            {activeTab === 'ssl' && (
              <div
                className={styles.tabPanel}
                role="tabpanel"
                data-testid="connection-form-panel-ssl"
              >
                <div className={styles.sslBlock}>
                  <div className={styles.sslCheckboxWrap}>
                    <Checkbox
                      id="ssl-enabled"
                      checked={formData.sslEnabled}
                      onChange={(e) => updateField('sslEnabled', e.target.checked)}
                      aria-label="Use SSL / TLS"
                    />
                  </div>
                  <div className={styles.sslCopy}>
                    <span className={styles.sslTitle}>Use SSL / TLS</span>
                    <span className={styles.sslHint}>
                      Required for AWS RDS and many managed clusters.
                    </span>
                  </div>
                </div>

                <div className={styles.sslFiles} data-testid="ssl-certificate-section">
                  <SslFileField
                    id="ssl-ca"
                    label="CA Certificate"
                    value={formData.sslCaPath ?? ''}
                    onChange={(val) => updateField('sslCaPath', val || null)}
                    onBrowse={() => void handleBrowseFile('sslCaPath')}
                    disabled={!formData.sslEnabled}
                    browseLabel="Browse CA certificate"
                    placeholder="/path/to/ca.pem"
                  />
                  <SslFileField
                    id="ssl-cert"
                    label="Client Certificate"
                    value={formData.sslCertPath ?? ''}
                    onChange={(val) => updateField('sslCertPath', val || null)}
                    onBrowse={() => void handleBrowseFile('sslCertPath')}
                    disabled={!formData.sslEnabled}
                    browseLabel="Browse client certificate"
                    placeholder="/path/to/client-cert.pem"
                  />
                  <SslFileField
                    id="ssl-key"
                    label="Client Key"
                    value={formData.sslKeyPath ?? ''}
                    onChange={(val) => updateField('sslKeyPath', val || null)}
                    onBrowse={() => void handleBrowseFile('sslKeyPath')}
                    disabled={!formData.sslEnabled}
                    browseLabel="Browse client key"
                    placeholder="/path/to/client-key.pem"
                  />
                </div>
              </div>
            )}

            {activeTab === 'advanced' && (
              <div
                className={styles.tabPanel}
                role="tabpanel"
                data-testid="connection-form-panel-advanced"
              >
                <div className={styles.rowEvenSplit}>
                  <div className={styles.fieldGroup}>
                    <label id="conn-group-label" htmlFor="conn-group" className={styles.labelCaps}>
                      Group
                    </label>
                    <Dropdown
                      id="conn-group"
                      labelledBy="conn-group-label"
                      listAriaLabel="Group"
                      options={groupDropdownOptions}
                      value={formData.groupId ?? ''}
                      onChange={(v) => updateField('groupId', v || null)}
                    />
                  </div>
                  <div className={styles.fieldGroup}>
                    <label
                      id="conn-access-label"
                      htmlFor="conn-access"
                      className={styles.labelCaps}
                    >
                      Access mode
                    </label>
                    <Dropdown
                      id="conn-access"
                      labelledBy="conn-access-label"
                      options={ACCESS_MODE_OPTIONS}
                      value={formData.readOnly ? 'ro' : 'rw'}
                      onChange={(v) => updateField('readOnly', v === 'ro')}
                    />
                  </div>
                </div>

                <div className={styles.fieldGroup}>
                  <span className={styles.labelCaps}>Tab color</span>
                  <div className={styles.tabColorRow}>
                    <ColorPickerPopover
                      color={formData.color}
                      onChange={(color) => updateField('color', color)}
                    />
                    <span className={styles.tabColorValue}>{formData.color ?? 'No color set'}</span>
                  </div>
                </div>

                <div className={styles.rowTimeouts}>
                  <div className={styles.fieldGroup}>
                    <label htmlFor="connect-timeout" className={styles.labelCaps}>
                      Connect Timeout
                    </label>
                    <div className={styles.numberInputRow}>
                      <TextInput
                        id="connect-timeout"
                        type="number"
                        variant="mono"
                        className={styles.numberField}
                        invalid={!!errors.connectTimeoutSecs}
                        value={formData.connectTimeoutSecs}
                        onChange={(e) =>
                          updateField('connectTimeoutSecs', parseInt(e.target.value, 10) || 10)
                        }
                        min={1}
                        max={300}
                      />
                      <span className={styles.unitLabel}>seconds</span>
                    </div>
                    {errors.connectTimeoutSecs && (
                      <span className={styles.errorText}>{errors.connectTimeoutSecs}</span>
                    )}
                  </div>
                  <div className={styles.fieldGroup}>
                    <label htmlFor="keepalive" className={styles.labelCaps}>
                      Keepalive Interval
                    </label>
                    <div className={styles.numberInputRow}>
                      <TextInput
                        id="keepalive"
                        type="number"
                        variant="mono"
                        className={styles.numberField}
                        invalid={!!errors.keepaliveIntervalSecs}
                        value={formData.keepaliveIntervalSecs}
                        onChange={(e) =>
                          updateField('keepaliveIntervalSecs', parseInt(e.target.value, 10) || 60)
                        }
                        min={0}
                        max={3600}
                      />
                      <span className={styles.unitLabel}>seconds</span>
                    </div>
                    {errors.keepaliveIntervalSecs && (
                      <span className={styles.errorText}>{errors.keepaliveIntervalSecs}</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </form>
        </ElevatedSurface>
      </div>

      <footer className={styles.formFooter}>
        <div className={styles.footerActionsLeft}>
          <Button
            variant="secondary"
            onClick={() => void handleTestConnection()}
            disabled={isAnyPending}
          >
            <Database size={20} weight="duotone" aria-hidden />
            {pendingAction === 'test' ? 'Testing…' : 'Test Connection'}
          </Button>
          {currentConnectionId ? (
            <Button
              variant="danger"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={isAnyPending}
            >
              Delete
            </Button>
          ) : null}
        </div>
        <div className={styles.footerActionsRight}>
          <Button variant="secondary" onClick={() => void handleSave()} disabled={isAnyPending}>
            {pendingAction === 'save' ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="primary" onClick={() => void handleConnect()} disabled={isAnyPending}>
            {pendingAction === 'connect' ? 'Connecting…' : 'Save and Connect'}
          </Button>
        </div>
      </footer>
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title="Delete Connection"
        message={
          <>
            Delete saved connection <strong>{formData.name.trim() || formData.host}</strong>?
          </>
        }
        portalRoot={dialogPortalRoot}
        confirmLabel="Delete"
        isDestructive
        isLoading={pendingAction === 'delete'}
        error={deleteConfirmError}
        nonDismissible={pendingAction === 'delete'}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (pendingAction === 'delete') {
            return
          }
          setDeleteConfirmOpen(false)
          setDeleteConfirmError(null)
        }}
      />
    </div>
  )
}
