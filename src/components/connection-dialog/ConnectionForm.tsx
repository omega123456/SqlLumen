import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Eye, EyeSlash, FolderOpen, Plug } from '@phosphor-icons/react'
import { open } from '@tauri-apps/plugin-dialog'
import { useConnectionStore } from '../../stores/connection-store'
import { useSettingsStore } from '../../stores/settings-store'
import { showErrorToast, showSuccessToast } from '../../stores/toast-store'
import { logFrontend } from '../../lib/app-log-commands'
import {
  deleteConnection,
  testConnection,
  saveConnection as saveConnectionIPC,
  updateConnection,
} from '../../lib/connection-commands'
import { Button } from '../common/Button'
import { TextInput } from '../common/TextInput'
import { IconButton } from '../common/IconButton'
import { Checkbox } from '../common/Checkbox'
import { Dropdown } from '../common/Dropdown'
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
import { toErrorMessage } from '../../lib/error-message'
import { isBlank } from '../../lib/value-checks'

const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10
const DEFAULT_KEEPALIVE_INTERVAL_SECONDS = 60
const MIN_PORT = 1
const MAX_PORT = 65535

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
    connectTimeoutSecs: isNaN(timeout) ? DEFAULT_CONNECT_TIMEOUT_SECONDS : timeout,
    keepaliveIntervalSecs: isNaN(keepalive) ? DEFAULT_KEEPALIVE_INTERVAL_SECONDS : keepalive,
  }
}

interface FormErrors {
  [key: string]: string
}

function isValidPort(port: number): boolean {
  return port >= MIN_PORT && port <= MAX_PORT
}

function validate(data: ConnectionFormData): FormErrors {
  const errors: FormErrors = {}
  if (isBlank(data.name)) {
    errors.name = 'Connection name is required'
  }
  if (isBlank(data.host)) {
    errors.host = 'Host is required'
  }
  if (isBlank(data.username)) {
    errors.username = 'Username is required'
  }
  if (!isValidPort(data.port)) {
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
function buildErrorResult(error: unknown): TestConnectionResultType {
  return {
    success: false,
    serverVersion: null,
    authMethod: null,
    sslStatus: null,
    connectionTimeMs: null,
    errorMessage: toErrorMessage(error),
  }
}

interface FormFieldProps {
  id: string
  label: string
  error?: string
  children: ReactNode
}

function FormField({ id, label, error, children }: FormFieldProps) {
  return (
    <div className={styles.fieldGroup}>
      <label htmlFor={id} className={styles.labelCaps}>
        {label}
      </label>
      {children}
      {error && <span className={styles.errorText}>{error}</span>}
    </div>
  )
}

interface SslFileFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
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
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
        />
        <Button
          variant="bare"
          className={styles.browseButton}
          onClick={onBrowse}
          disabled={disabled}
          aria-label={browseLabel}
        >
          <FolderOpen size={16} />
        </Button>
      </div>
    </div>
  )
}

type UpdateField = <K extends keyof ConnectionFormData>(
  field: K,
  value: ConnectionFormData[K]
) => void

type SslPathField = 'sslCaPath' | 'sslCertPath' | 'sslKeyPath'

type PendingAction = 'test' | 'save' | 'connect' | 'delete'

interface FormFields {
  formData: ConnectionFormData
  errors: FormErrors
  updateField: UpdateField
}

interface PasswordControls {
  showPassword: boolean
  hasSavedPassword: boolean
  clearSavedPassword: boolean
  showDuplicateHint: boolean
  onPasswordChange: (value: string) => void
  onToggleShowPassword: () => void
  onClearSavedPasswordChange: (checked: boolean) => void
}

const SAVED_PASSWORD_MASK = '••••••••'

function formDataFromConnection(connection: SavedConnection): ConnectionFormData {
  return {
    name: connection.name,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: '',
    defaultDatabase: connection.defaultDatabase,
    sslEnabled: connection.sslEnabled,
    sslCaPath: connection.sslCaPath,
    sslCertPath: connection.sslCertPath,
    sslKeyPath: connection.sslKeyPath,
    color: connection.color,
    groupId: connection.groupId,
    readOnly: connection.readOnly,
    connectTimeoutSecs: connection.connectTimeoutSecs,
    keepaliveIntervalSecs: connection.keepaliveIntervalSecs,
  }
}

function seededFormData(initialData: ConnectionFormSeed | undefined): ConnectionFormData {
  if (!initialData) return getDefaultFormData()
  return { ...initialData.data }
}

interface CurrentConnectionInputs {
  savedId: string | null
  editingConnection: SavedConnection | undefined
  deletedConnectionId: string | null
}

function resolveCurrentConnectionId(inputs: CurrentConnectionInputs): string | null {
  if (inputs.savedId) return inputs.savedId
  const editingId = inputs.editingConnection?.id
  if (!editingId) return null
  if (editingId === inputs.deletedConnectionId) return null
  return editingId
}

interface DuplicateHintInputs {
  editingConnection: SavedConnection | undefined
  savedId: string | null
  initialData: ConnectionFormSeed | undefined
}

function shouldShowDuplicatePasswordHint(inputs: DuplicateHintInputs): boolean {
  if (inputs.editingConnection) return false
  if (inputs.savedId !== null) return false
  return inputs.initialData?.sourceHadPassword === true
}

function connectionTitle(formData: ConnectionFormData): string {
  return formData.name.trim() || formData.host.trim() || 'New connection'
}

function connectionSubtitle(formData: ConnectionFormData): string {
  const host = formData.host.trim()
  if (!host) return 'Configure the parameters for your MySQL instance.'
  const username = formData.username.trim()
  const userPrefix = username ? `${username}@` : ''
  return `${userPrefix}${host}:${formData.port}`
}

function deleteTargetName(formData: ConnectionFormData): string {
  return formData.name.trim() || formData.host
}

function savedPasswordPlaceholder(password: PasswordControls): string {
  if (!password.hasSavedPassword) return ''
  if (password.clearSavedPassword) return ''
  return SAVED_PASSWORD_MASK
}

function ConnectionFormHeader({ formData }: { formData: ConnectionFormData }) {
  return (
    <header className={styles.formHeader} data-testid="connection-form-header">
      <div className={styles.formHeaderText}>
        <h3 className={styles.formHeaderName}>{connectionTitle(formData)}</h3>
        <span className={styles.formHeaderMeta}>{connectionSubtitle(formData)}</span>
      </div>
    </header>
  )
}

interface PasswordFieldProps {
  value: string
  password: PasswordControls
}

function PasswordField({ value, password }: PasswordFieldProps) {
  return (
    <FormField id="conn-password" label="Password">
      <div className={styles.passwordWrapper}>
        <TextInput
          id="conn-password"
          type={password.showPassword ? 'text' : 'password'}
          passwordToggleGutter
          value={value}
          onChange={(event) => password.onPasswordChange(event.target.value)}
          placeholder={savedPasswordPlaceholder(password)}
          disabled={password.clearSavedPassword}
        />
        <IconButton
          size="sm"
          className={styles.passwordToggle}
          onClick={password.onToggleShowPassword}
          aria-label={password.showPassword ? 'Hide password' : 'Show password'}
        >
          {password.showPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
        </IconButton>
      </div>
      {password.showDuplicateHint && (
        <span className={styles.fieldHint} data-testid="duplicate-password-hint">
          Password is not copied — enter it to save.
        </span>
      )}
      {password.hasSavedPassword && (
        <label className={styles.label}>
          <Checkbox
            checked={password.clearSavedPassword}
            onChange={(event) => password.onClearSavedPasswordChange(event.target.checked)}
          />{' '}
          Use no password (remove saved password)
        </label>
      )}
    </FormField>
  )
}

interface GeneralPanelProps {
  fields: FormFields
  nameAutoFocus: boolean
  password: PasswordControls
}

function GeneralPanel({ fields, nameAutoFocus, password }: GeneralPanelProps) {
  return (
    <div className={styles.tabPanel} role="tabpanel" data-testid="connection-form-panel-general">
      <FormField id="conn-name" label="Connection name" error={fields.errors.name}>
        <TextInput
          id="conn-name"
          type="text"
          invalid={!!fields.errors.name}
          value={fields.formData.name}
          onChange={(event) => fields.updateField('name', event.target.value)}
          placeholder="My production server"
          autoFocus={nameAutoFocus}
        />
      </FormField>

      <div className={styles.row2}>
        <FormField id="conn-host" label="Host address" error={fields.errors.host}>
          <TextInput
            id="conn-host"
            type="text"
            variant="mono"
            invalid={!!fields.errors.host}
            value={fields.formData.host}
            onChange={(event) => fields.updateField('host', event.target.value)}
            placeholder="localhost"
          />
        </FormField>
        <FormField id="conn-port" label="Port" error={fields.errors.port}>
          <TextInput
            id="conn-port"
            type="number"
            variant="mono"
            invalid={!!fields.errors.port}
            value={fields.formData.port}
            onChange={(event) => fields.updateField('port', parseInt(event.target.value, 10) || 0)}
            min={1}
            max={65535}
            placeholder="3306"
          />
        </FormField>
      </div>

      <div className={styles.rowUserPass}>
        <FormField id="conn-username" label="Username" error={fields.errors.username}>
          <TextInput
            id="conn-username"
            type="text"
            variant="mono"
            invalid={!!fields.errors.username}
            value={fields.formData.username}
            onChange={(event) => fields.updateField('username', event.target.value)}
            placeholder="root"
          />
        </FormField>
        <PasswordField value={fields.formData.password} password={password} />
      </div>

      <FormField id="conn-database" label="Default database">
        <TextInput
          id="conn-database"
          type="text"
          variant="mono"
          value={fields.formData.defaultDatabase ?? ''}
          onChange={(event) => fields.updateField('defaultDatabase', event.target.value || null)}
          placeholder="mydb"
        />
      </FormField>
    </div>
  )
}

interface SslPanelProps {
  fields: FormFields
  onBrowseFile: (field: SslPathField) => void
}

function SslPanel({ fields, onBrowseFile }: SslPanelProps) {
  return (
    <div className={styles.tabPanel} role="tabpanel" data-testid="connection-form-panel-ssl">
      <div className={styles.sslBlock}>
        <div className={styles.sslCheckboxWrap}>
          <Checkbox
            id="ssl-enabled"
            checked={fields.formData.sslEnabled}
            onChange={(event) => fields.updateField('sslEnabled', event.target.checked)}
            aria-label="Use SSL / TLS"
          />
        </div>
        <div className={styles.sslCopy}>
          <span className={styles.sslTitle}>Use SSL / TLS</span>
          <span className={styles.sslHint}>Required for AWS RDS and many managed clusters.</span>
        </div>
      </div>

      <div className={styles.sslFiles} data-testid="ssl-certificate-section">
        <SslFileField
          id="ssl-ca"
          label="CA certificate"
          value={fields.formData.sslCaPath ?? ''}
          onChange={(value) => fields.updateField('sslCaPath', value || null)}
          onBrowse={() => onBrowseFile('sslCaPath')}
          disabled={!fields.formData.sslEnabled}
          browseLabel="Browse CA certificate"
          placeholder="/path/to/ca.pem"
        />
        <SslFileField
          id="ssl-cert"
          label="Client certificate"
          value={fields.formData.sslCertPath ?? ''}
          onChange={(value) => fields.updateField('sslCertPath', value || null)}
          onBrowse={() => onBrowseFile('sslCertPath')}
          disabled={!fields.formData.sslEnabled}
          browseLabel="Browse client certificate"
          placeholder="/path/to/client-cert.pem"
        />
        <SslFileField
          id="ssl-key"
          label="Client key"
          value={fields.formData.sslKeyPath ?? ''}
          onChange={(value) => fields.updateField('sslKeyPath', value || null)}
          onBrowse={() => onBrowseFile('sslKeyPath')}
          disabled={!fields.formData.sslEnabled}
          browseLabel="Browse client key"
          placeholder="/path/to/client-key.pem"
        />
      </div>
    </div>
  )
}

interface AdvancedPanelProps {
  fields: FormFields
  groupDropdownOptions: { value: string; label: string }[]
}

function AdvancedPanel({ fields, groupDropdownOptions }: AdvancedPanelProps) {
  return (
    <div className={styles.tabPanel} role="tabpanel" data-testid="connection-form-panel-advanced">
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
            value={fields.formData.groupId ?? ''}
            onChange={(value) => fields.updateField('groupId', value || null)}
          />
        </div>
        <div className={styles.fieldGroup}>
          <label id="conn-access-label" htmlFor="conn-access" className={styles.labelCaps}>
            Access mode
          </label>
          <Dropdown
            id="conn-access"
            labelledBy="conn-access-label"
            options={ACCESS_MODE_OPTIONS}
            value={fields.formData.readOnly ? 'ro' : 'rw'}
            onChange={(value) => fields.updateField('readOnly', value === 'ro')}
          />
        </div>
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.labelCaps}>Tab color</span>
        <div className={styles.tabColorRow}>
          <ColorPickerPopover
            color={fields.formData.color}
            onChange={(color) => fields.updateField('color', color)}
          />
          <span className={styles.tabColorValue}>{fields.formData.color ?? 'No color set'}</span>
        </div>
      </div>

      <div className={styles.rowTimeouts}>
        <FormField
          id="connect-timeout"
          label="Connect timeout"
          error={fields.errors.connectTimeoutSecs}
        >
          <div className={styles.numberInputRow}>
            <TextInput
              id="connect-timeout"
              type="number"
              variant="mono"
              className={styles.numberField}
              invalid={!!fields.errors.connectTimeoutSecs}
              value={fields.formData.connectTimeoutSecs}
              onChange={(event) =>
                fields.updateField(
                  'connectTimeoutSecs',
                  parseInt(event.target.value, 10) || DEFAULT_CONNECT_TIMEOUT_SECONDS
                )
              }
              min={1}
              max={300}
            />
            <span className={styles.unitLabel}>seconds</span>
          </div>
        </FormField>
        <FormField
          id="keepalive"
          label="Keepalive interval"
          error={fields.errors.keepaliveIntervalSecs}
        >
          <div className={styles.numberInputRow}>
            <TextInput
              id="keepalive"
              type="number"
              variant="mono"
              className={styles.numberField}
              invalid={!!fields.errors.keepaliveIntervalSecs}
              value={fields.formData.keepaliveIntervalSecs}
              onChange={(event) =>
                fields.updateField(
                  'keepaliveIntervalSecs',
                  parseInt(event.target.value, 10) || DEFAULT_KEEPALIVE_INTERVAL_SECONDS
                )
              }
              min={0}
              max={3600}
            />
            <span className={styles.unitLabel}>seconds</span>
          </div>
        </FormField>
      </div>
    </div>
  )
}

const PENDING_ACTION_LABELS: Record<Exclude<PendingAction, 'delete'>, string> = {
  test: 'Testing…',
  connect: 'Connecting…',
  save: 'Saving…',
}

interface ActionLabelInputs {
  pendingAction: PendingAction | null
  action: Exclude<PendingAction, 'delete'>
  idleLabel: string
}

function actionLabel(inputs: ActionLabelInputs): string {
  if (inputs.pendingAction === inputs.action) return PENDING_ACTION_LABELS[inputs.action]
  return inputs.idleLabel
}

interface ConnectionFormFooterProps {
  pendingAction: PendingAction | null
  canDelete: boolean
  onTest: () => void
  onDeleteRequest: () => void
  onConnect: () => void
  onSave: () => void
}

function ConnectionFormFooter({
  pendingAction,
  canDelete,
  onTest,
  onDeleteRequest,
  onConnect,
  onSave,
}: ConnectionFormFooterProps) {
  const isAnyPending = pendingAction !== null
  return (
    <footer className={styles.formFooter}>
      <div className={styles.footerActionsLeft}>
        <Button onClick={onTest} disabled={isAnyPending}>
          <Plug size={16} weight="regular" aria-hidden />
          {actionLabel({
            pendingAction: pendingAction,
            action: 'test',
            idleLabel: 'Test connection',
          })}
        </Button>
        {canDelete ? (
          <Button variant="danger" onClick={onDeleteRequest} disabled={isAnyPending}>
            Delete
          </Button>
        ) : null}
      </div>
      <div className={styles.footerActionsRight}>
        <Button variant="accent" onClick={onConnect} disabled={isAnyPending}>
          {actionLabel({
            pendingAction: pendingAction,
            action: 'connect',
            idleLabel: 'Save and connect',
          })}
        </Button>
        <Button onClick={onSave} disabled={isAnyPending}>
          {actionLabel({ pendingAction: pendingAction, action: 'save', idleLabel: 'Save' })}
        </Button>
      </div>
    </footer>
  )
}

interface DeleteConfirmState {
  error: string | null
}

interface ConnectionEditorState {
  formData: ConnectionFormData
  errors: FormErrors
  activeTab: FormTab
  testResult: TestConnectionResultType | null
  savedId: string | null
  hasSavedPassword: boolean
  clearSavedPassword: boolean
  deletedConnectionId: string | null
  deleteConfirm: DeleteConfirmState | null
}

function createIdleEditorState(): ConnectionEditorState {
  return {
    formData: getDefaultFormData(),
    errors: {},
    activeTab: 'general',
    testResult: null,
    savedId: null,
    hasSavedPassword: false,
    clearSavedPassword: false,
    deletedConnectionId: null,
    deleteConfirm: null,
  }
}

function editorStateFor(
  editingConnection: SavedConnection | undefined,
  initialData: ConnectionFormSeed | undefined
): ConnectionEditorState {
  const idle = createIdleEditorState()
  if (editingConnection) {
    return {
      ...idle,
      formData: formDataFromConnection(editingConnection),
      savedId: editingConnection.id,
      hasSavedPassword: editingConnection.hasPassword,
    }
  }
  return { ...idle, formData: seededFormData(initialData) }
}

function deletedEditorState(
  current: ConnectionEditorState,
  deletedConnectionId: string
): ConnectionEditorState {
  return {
    ...createIdleEditorState(),
    activeTab: current.activeTab,
    deletedConnectionId: deletedConnectionId,
  }
}

function withoutFieldError(errors: FormErrors, field: string): FormErrors {
  if (!errors[field]) return errors
  const next = { ...errors }
  delete next[field]
  return next
}

export function ConnectionForm({
  editingConnection,
  onDeleteConnection,
  initialData,
}: ConnectionFormProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const nameAutoFocusRef = useRef(true)
  const [editor, setEditor] = useState<ConnectionEditorState>(createIdleEditorState)
  const {
    formData,
    errors,
    activeTab,
    testResult,
    savedId,
    hasSavedPassword,
    clearSavedPassword,
    deletedConnectionId,
    deleteConfirm,
  } = editor
  const [showPassword, setShowPassword] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [dialogPortalRoot, setDialogPortalRoot] = useState<HTMLElement | null>(null)

  const patchEditor = (patch: Partial<ConnectionEditorState>) =>
    setEditor((current) => ({ ...current, ...patch }))

  const connectionGroups = useConnectionStore((state) => state.connectionGroups)
  const fetchSavedConnections = useConnectionStore((state) => state.fetchSavedConnections)
  const groupDropdownOptions = useMemo(
    () => [
      { value: '', label: 'Ungrouped' },
      ...connectionGroups.map((group) => ({ value: group.id, label: group.name })),
    ],
    [connectionGroups]
  )
  const openConnection = useConnectionStore((state) => state.openConnection)
  const closeDialog = useConnectionStore((state) => state.closeDialog)

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
    setEditor(editorStateFor(editingConnection, initialData))
  }, [editingConnection, initialData])

  useEffect(() => {
    nameAutoFocusRef.current = false
  }, [])

  const updateField = <K extends keyof ConnectionFormData>(
    field: K,
    value: ConnectionFormData[K]
  ) => {
    setEditor((current) => ({
      ...current,
      formData: { ...current.formData, [field]: value },
      errors: withoutFieldError(current.errors, field),
    }))
  }

  const handleBrowseFile = async (field: SslPathField) => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Certificates', extensions: ['pem', 'crt', 'key'] }],
      })
      if (typeof selected === 'string') {
        updateField(field, selected)
      }
    } catch (error) {
      logFrontend('warn', `[connection-form] Certificate file dialog failed: ${String(error)}`)
    }
  }

  const currentConnectionId = resolveCurrentConnectionId({
    savedId: savedId,
    editingConnection: editingConnection,
    deletedConnectionId: deletedConnectionId,
  })

  const handlePasswordChange = (value: string) => {
    updateField('password', value)
    if (clearSavedPassword) {
      patchEditor({ clearSavedPassword: false })
    }
  }

  const handleClearSavedPasswordChange = (checked: boolean) => {
    patchEditor({ clearSavedPassword: checked })
    if (checked && formData.password) {
      updateField('password', '')
    }
  }

  const cancelDeleteConfirm = () => {
    if (pendingAction === 'delete') {
      return
    }
    patchEditor({ deleteConfirm: null })
  }

  function runValidation(): boolean {
    const errs = validate(formData)
    const errorTab = firstTabWithError(errs)
    if (errorTab) {
      patchEditor({ errors: errs, activeTab: errorTab })
      return false
    }
    patchEditor({ errors: errs })
    return true
  }

  const tabHasError = (tab: FormTab): boolean =>
    Object.keys(errors).some((field) => (FIELD_TAB[field] ?? 'general') === tab)

  const reportFailure = (error: unknown, toastTitle: string): TestConnectionResultType => {
    const failure = buildErrorResult(error)
    patchEditor({ testResult: failure })
    showErrorToast(toastTitle, failure.errorMessage ?? undefined)
    return failure
  }

  const handleTestConnection = async () => {
    if (!runValidation()) {
      return
    }

    setPendingAction('test')
    patchEditor({ testResult: null })
    try {
      // Use the saved keychain password only when none was freshly typed and the
      // user isn't explicitly clearing it.
      const useSavedPassword = hasSavedPassword && !clearSavedPassword && formData.password === ''
      const result = await testConnection(formData, useSavedPassword ? currentConnectionId : null)
      patchEditor({ testResult: result })
    } catch (error) {
      reportFailure(error, 'Connection test failed')
    } finally {
      setPendingAction(null)
    }
  }

  const persistConnection = async (): Promise<string> => {
    const existingId = savedId ?? editingConnection?.id
    if (existingId) {
      await updateConnection(existingId, formData, { clearPassword: clearSavedPassword })
      patchEditor({
        hasSavedPassword: clearSavedPassword ? false : hasSavedPassword || formData.password !== '',
      })
      await fetchSavedConnections()
      return existingId
    }
    const newId = await saveConnectionIPC(formData)
    patchEditor({ savedId: newId, hasSavedPassword: formData.password !== '' })
    await fetchSavedConnections()
    return newId
  }

  const handleSave = async () => {
    if (!runValidation()) {
      return
    }

    setPendingAction('save')
    try {
      await persistConnection()
      patchEditor({ clearSavedPassword: false })
      showSuccessToast('Connection saved', formData.name.trim() || undefined)
    } catch (error) {
      reportFailure(error, 'Failed to save connection')
    } finally {
      setPendingAction(null)
    }
  }

  const handleConnect = async () => {
    if (!runValidation()) {
      return
    }

    setPendingAction('connect')
    let connectionId: string
    try {
      connectionId = await persistConnection()
      patchEditor({ clearSavedPassword: false })
    } catch (error) {
      reportFailure(error, 'Failed to save connection')
      setPendingAction(null)
      return
    }

    try {
      await openConnection(connectionId)
      closeDialog()
    } catch (error) {
      patchEditor({ testResult: buildErrorResult(error) })
    } finally {
      setPendingAction(null)
    }
  }

  const handleDelete = async () => {
    if (!currentConnectionId) {
      return
    }

    setPendingAction('delete')
    patchEditor({ deleteConfirm: { error: null } })
    try {
      await deleteConnection(currentConnectionId)
      await fetchSavedConnections()
      setEditor((current) => deletedEditorState(current, currentConnectionId))
      onDeleteConnection?.(currentConnectionId)
      showSuccessToast('Connection deleted')
    } catch (error) {
      const failure = reportFailure(error, 'Failed to delete connection')
      patchEditor({
        deleteConfirm: { error: failure.errorMessage ?? 'Failed to delete connection' },
      })
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <div ref={rootRef} className={styles.formGridRoot}>
      <div className={styles.formMain} data-testid="connection-form-main">
        <ConnectionFormHeader formData={formData} />
        <form
          className={styles.formInner}
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault()
          }}
        >
          <UnderlineTabBar className={styles.formTabBar} data-testid="connection-form-tabs">
            {TAB_ORDER.map((tab) => (
              <UnderlineTab
                key={tab}
                active={activeTab === tab}
                onClick={() => patchEditor({ activeTab: tab })}
                data-testid={`connection-form-tab-${tab}`}
              >
                {TAB_LABELS[tab]}
                {tabHasError(tab) && (
                  <span className={styles.tabErrorDot} aria-label="Has errors" />
                )}
              </UnderlineTab>
            ))}
          </UnderlineTabBar>

          {testResult ? (
            <div className={styles.testResultSlot}>
              <TestConnectionResult result={testResult} />
            </div>
          ) : null}

          {activeTab === 'general' && (
            <GeneralPanel
              fields={{ formData: formData, errors: errors, updateField: updateField }}
              nameAutoFocus={nameAutoFocusRef.current}
              password={{
                showPassword: showPassword,
                hasSavedPassword: hasSavedPassword,
                clearSavedPassword: clearSavedPassword,
                showDuplicateHint: shouldShowDuplicatePasswordHint({
                  editingConnection: editingConnection,
                  savedId: savedId,
                  initialData: initialData,
                }),
                onPasswordChange: handlePasswordChange,
                onToggleShowPassword: () => setShowPassword((previous) => !previous),
                onClearSavedPasswordChange: handleClearSavedPasswordChange,
              }}
            />
          )}

          {activeTab === 'ssl' && (
            <SslPanel
              fields={{ formData: formData, errors: errors, updateField: updateField }}
              onBrowseFile={(field) => void handleBrowseFile(field)}
            />
          )}

          {activeTab === 'advanced' && (
            <AdvancedPanel
              fields={{ formData: formData, errors: errors, updateField: updateField }}
              groupDropdownOptions={groupDropdownOptions}
            />
          )}
        </form>
      </div>

      <ConnectionFormFooter
        pendingAction={pendingAction}
        canDelete={currentConnectionId !== null}
        onTest={() => void handleTestConnection()}
        onDeleteRequest={() => patchEditor({ deleteConfirm: { error: null } })}
        onConnect={() => void handleConnect()}
        onSave={() => void handleSave()}
      />
      <ConfirmDialog
        isOpen={deleteConfirm !== null}
        title="Delete connection"
        message={
          <>
            Delete saved connection <strong>{deleteTargetName(formData)}</strong>?
          </>
        }
        portalRoot={dialogPortalRoot}
        confirmLabel="Delete"
        isDestructive
        isLoading={pendingAction === 'delete'}
        error={deleteConfirm?.error ?? null}
        nonDismissible={pendingAction === 'delete'}
        onConfirm={() => void handleDelete()}
        onCancel={cancelDeleteConfirm}
      />
    </div>
  )
}
