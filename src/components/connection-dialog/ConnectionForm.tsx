import { useCallback, useState, useMemo, type ReactNode } from 'react'
import { Eye, EyeSlash, FolderOpen, Plug } from '@phosphor-icons/react'
import { useConnectionStore } from '../../stores/connection-store'
import { Button } from '../common/Button'
import { TextInput } from '../common/TextInput'
import { IconButton } from '../common/IconButton'
import { Checkbox } from '../common/Checkbox'
import { Dropdown } from '../common/Dropdown'
import { UnderlineTabBar, UnderlineTab } from '../common/UnderlineTabs'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { ColorPickerPopover } from './ColorPickerPopover'
import { TestConnectionResult } from './TestConnectionResult'
import type { ConnectionFormData, SavedConnection } from '../../types/connection'
import styles from './ConnectionForm.module.css'
import {
  DEFAULT_CONNECT_TIMEOUT_SECONDS,
  DEFAULT_KEEPALIVE_INTERVAL_SECONDS,
  TAB_ORDER,
  tabHasError,
  type ConnectionFormSeed,
  type FormErrors,
  type FormTab,
  type PendingAction,
  type SslPathField,
  type UpdateField,
} from './connection-editor-state'
import { useConnectionFormActions } from './useConnectionFormActions'

export type { ConnectionFormSeed }

interface ConnectionFormProps {
  editingConnection?: SavedConnection
  onDeleteConnection?: (id: string) => void
  /** Prefill the form as a new, unsaved connection (used by Duplicate). */
  initialData?: ConnectionFormSeed
}

const TAB_LABELS: Record<FormTab, string> = {
  general: 'General',
  ssl: 'SSL',
  advanced: 'Advanced',
}

const ACCESS_MODE_OPTIONS = [
  { value: 'rw', label: 'Allow writes (read-write)' },
  { value: 'ro', label: 'Read-only (block writes)' },
]

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

function enclosingDialog(element: HTMLElement | null): HTMLDialogElement | null {
  const dialog = element?.closest('dialog')
  if (dialog instanceof HTMLDialogElement) return dialog
  return null
}

function useNameAutoFocus(activeTab: FormTab): boolean {
  const [nameAutoFocus, setNameAutoFocus] = useState(true)
  const hasLeftGeneralTab = activeTab !== 'general'
  const shouldStopAutoFocus = nameAutoFocus && hasLeftGeneralTab
  if (shouldStopAutoFocus) {
    setNameAutoFocus(false)
  }
  return nameAutoFocus
}

export function ConnectionForm({
  editingConnection,
  onDeleteConnection,
  initialData,
}: ConnectionFormProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [dialogPortalRoot, setDialogPortalRoot] = useState<HTMLElement | null>(null)
  const form = useConnectionFormActions({
    editingConnection: editingConnection,
    initialData: initialData,
    onDeleteConnection: onDeleteConnection,
  })
  const { pendingAction, currentConnectionId, updateField } = form
  const { formData, errors, activeTab, testResult, savedId, deleteConfirm } = form.editor
  const { hasSavedPassword, clearSavedPassword } = form.editor
  const nameAutoFocus = useNameAutoFocus(activeTab)

  const connectionGroups = useConnectionStore((state) => state.connectionGroups)
  const groupDropdownOptions = useMemo(
    () => [
      { value: '', label: 'Ungrouped' },
      ...connectionGroups.map((group) => ({ value: group.id, label: group.name })),
    ],
    [connectionGroups]
  )

  const rootRef = useCallback((root: HTMLDivElement | null) => {
    setDialogPortalRoot(enclosingDialog(root))
  }, [])

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
                onClick={() => form.selectTab(tab)}
                data-testid={`connection-form-tab-${tab}`}
              >
                {TAB_LABELS[tab]}
                {tabHasError(errors, tab) && (
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
              nameAutoFocus={nameAutoFocus}
              password={{
                showPassword: showPassword,
                hasSavedPassword: hasSavedPassword,
                clearSavedPassword: clearSavedPassword,
                showDuplicateHint: shouldShowDuplicatePasswordHint({
                  editingConnection: editingConnection,
                  savedId: savedId,
                  initialData: initialData,
                }),
                onPasswordChange: form.changePassword,
                onToggleShowPassword: () => setShowPassword((previous) => !previous),
                onClearSavedPasswordChange: form.changeClearSavedPassword,
              }}
            />
          )}

          {activeTab === 'ssl' && (
            <SslPanel
              fields={{ formData: formData, errors: errors, updateField: updateField }}
              onBrowseFile={(field) => void form.browseSslFile(field)}
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
        onTest={() => void form.runTestConnection()}
        onDeleteRequest={form.requestDelete}
        onConnect={() => void form.connect()}
        onSave={() => void form.save()}
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
        onConfirm={() => void form.deleteCurrentConnection()}
        onCancel={form.cancelDeleteConfirm}
      />
    </div>
  )
}
