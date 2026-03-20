import { useState, useEffect } from 'react'
import { Eye, EyeSlash, FolderOpen } from '@phosphor-icons/react'
import { open } from '@tauri-apps/plugin-dialog'
import { useConnectionStore } from '../../stores/connection-store'
import {
  testConnection,
  saveConnection as saveConnectionIPC,
  updateConnection,
} from '../../lib/connection-commands'
import { CollapsibleSection } from './CollapsibleSection'
import { ColorPickerPopover } from './ColorPickerPopover'
import { TestConnectionResult } from './TestConnectionResult'
import type {
  ConnectionFormData,
  SavedConnection,
  TestConnectionResult as TestConnectionResultType,
} from '../../types/connection'
import styles from './ConnectionForm.module.css'

interface ConnectionFormProps {
  editingConnection?: SavedConnection
}

const DEFAULT_FORM_DATA: ConnectionFormData = {
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
  connectTimeoutSecs: 10,
  keepaliveIntervalSecs: 60,
}

interface FormErrors {
  [key: string]: string
}

function validate(data: ConnectionFormData): FormErrors {
  const errors: FormErrors = {}
  if (!data.host.trim()) errors.host = 'Host is required'
  if (!data.username.trim()) errors.username = 'Username is required'
  if (!data.port || data.port < 1 || data.port > 65535)
    errors.port = 'Port must be between 1 and 65535'
  if (data.connectTimeoutSecs < 1)
    errors.connectTimeoutSecs = 'Connect timeout must be at least 1 second'
  if (data.keepaliveIntervalSecs < 0)
    errors.keepaliveIntervalSecs = 'Keepalive interval cannot be negative'
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
        <input
          type="text"
          id={id}
          className={styles.input}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
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

export function ConnectionForm({ editingConnection }: ConnectionFormProps) {
  const [formData, setFormData] = useState<ConnectionFormData>(DEFAULT_FORM_DATA)
  const [errors, setErrors] = useState<FormErrors>({})
  const [showPassword, setShowPassword] = useState(false)
  const [testResult, setTestResult] = useState<TestConnectionResultType | null>(null)
  const [pendingAction, setPendingAction] = useState<'test' | 'save' | 'connect' | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  const connectionGroups = useConnectionStore((s) => s.connectionGroups)
  const fetchSavedConnections = useConnectionStore((s) => s.fetchSavedConnections)
  const openConnection = useConnectionStore((s) => s.openConnection)
  const closeDialog = useConnectionStore((s) => s.closeDialog)

  // Populate form when editingConnection changes
  useEffect(() => {
    if (editingConnection) {
      setFormData({
        name: editingConnection.name,
        host: editingConnection.host,
        port: editingConnection.port,
        username: editingConnection.username,
        password: '', // Always empty — user re-enters or leaves blank to keep existing
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
    } else {
      setFormData(DEFAULT_FORM_DATA)
      setSavedId(null)
    }
    setErrors({})
    setTestResult(null)
  }, [editingConnection])

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

  function runValidation(): boolean {
    const errs = validate(formData)
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleTestConnection = async () => {
    if (!runValidation()) return

    setPendingAction('test')
    setTestResult(null)
    try {
      const result = await testConnection(formData)
      setTestResult(result)
    } catch (err) {
      setTestResult(buildErrorResult(err))
    } finally {
      setPendingAction(null)
    }
  }

  const handleSave = async () => {
    if (!runValidation()) return

    setPendingAction('save')
    try {
      const existingId = savedId ?? editingConnection?.id
      if (existingId) {
        await updateConnection(existingId, formData)
      } else {
        const newId = await saveConnectionIPC(formData)
        setSavedId(newId)
      }
      await fetchSavedConnections()
    } catch (err) {
      setTestResult(buildErrorResult(err))
    } finally {
      setPendingAction(null)
    }
  }

  const handleConnect = async () => {
    if (!runValidation()) return

    setPendingAction('connect')
    try {
      let connectionId = savedId ?? editingConnection?.id

      if (connectionId) {
        // Existing connection — persist any unsaved edits first
        await updateConnection(connectionId, formData)
        await fetchSavedConnections()
      } else {
        // New unsaved connection — save first
        connectionId = await saveConnectionIPC(formData)
        await fetchSavedConnections()
      }

      await openConnection(connectionId)
      closeDialog()
    } catch (err) {
      setTestResult(buildErrorResult(err))
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <form className={styles.form} onSubmit={(e) => e.preventDefault()}>
      {/* Connection Name */}
      <div className={styles.fieldGroup}>
        <label htmlFor="conn-name" className={styles.label}>
          Connection Name
        </label>
        <input
          id="conn-name"
          type="text"
          className={styles.input}
          value={formData.name}
          onChange={(e) => updateField('name', e.target.value)}
          placeholder="My Database"
          autoFocus
        />
      </div>

      {/* Host + Port */}
      <div className={styles.hostPortRow}>
        <div className={styles.fieldGroup}>
          <label htmlFor="conn-host" className={styles.label}>
            Host
          </label>
          <input
            id="conn-host"
            type="text"
            className={`${styles.input} ${errors.host ? styles.inputError : ''}`}
            value={formData.host}
            onChange={(e) => updateField('host', e.target.value)}
            placeholder="localhost"
          />
          {errors.host && <span className={styles.errorText}>{errors.host}</span>}
        </div>
        <div className={styles.fieldGroup}>
          <label htmlFor="conn-port" className={styles.label}>
            Port
          </label>
          <input
            id="conn-port"
            type="number"
            className={`${styles.input} ${errors.port ? styles.inputError : ''}`}
            value={formData.port}
            onChange={(e) => updateField('port', parseInt(e.target.value, 10) || 0)}
            min={1}
            max={65535}
          />
          {errors.port && <span className={styles.errorText}>{errors.port}</span>}
        </div>
      </div>

      {/* Username */}
      <div className={styles.fieldGroup}>
        <label htmlFor="conn-username" className={styles.label}>
          Username
        </label>
        <input
          id="conn-username"
          type="text"
          className={`${styles.input} ${errors.username ? styles.inputError : ''}`}
          value={formData.username}
          onChange={(e) => updateField('username', e.target.value)}
          placeholder="root"
        />
        {errors.username && <span className={styles.errorText}>{errors.username}</span>}
      </div>

      {/* Password */}
      <div className={styles.fieldGroup}>
        <label htmlFor="conn-password" className={styles.label}>
          Password
        </label>
        <div className={styles.passwordWrapper}>
          <input
            id="conn-password"
            type={showPassword ? 'text' : 'password'}
            className={styles.passwordInput}
            value={formData.password}
            onChange={(e) => updateField('password', e.target.value)}
            placeholder={editingConnection?.hasPassword ? '••••••••' : ''}
          />
          <button
            type="button"
            className={styles.passwordToggle}
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      {/* Default Database */}
      <div className={styles.fieldGroup}>
        <label htmlFor="conn-database" className={styles.label}>
          Default Database
        </label>
        <input
          id="conn-database"
          type="text"
          className={styles.input}
          value={formData.defaultDatabase ?? ''}
          onChange={(e) => updateField('defaultDatabase', e.target.value || null)}
          placeholder="mydb"
        />
      </div>

      {/* SSL Settings */}
      <CollapsibleSection title="SSL Settings">
        <div className={styles.sectionContent}>
          <div className={styles.toggleRow}>
            <label htmlFor="ssl-enabled" className={styles.label}>
              Enable SSL
            </label>
            <input
              id="ssl-enabled"
              type="checkbox"
              checked={formData.sslEnabled}
              onChange={(e) => updateField('sslEnabled', e.target.checked)}
            />
          </div>

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
      </CollapsibleSection>

      {/* Advanced Settings */}
      <CollapsibleSection title="Advanced">
        <div className={styles.sectionContent}>
          <div className={styles.toggleRow}>
            <label htmlFor="read-only" className={styles.label}>
              Read Only
            </label>
            <input
              id="read-only"
              type="checkbox"
              checked={formData.readOnly}
              onChange={(e) => updateField('readOnly', e.target.checked)}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="connect-timeout" className={styles.label}>
              Connect Timeout
            </label>
            <div className={styles.numberInputRow}>
              <input
                id="connect-timeout"
                type="number"
                className={styles.input}
                value={formData.connectTimeoutSecs}
                onChange={(e) =>
                  updateField('connectTimeoutSecs', parseInt(e.target.value, 10) || 10)
                }
                min={1}
                max={300}
              />
              <span className={styles.unitLabel}>seconds</span>
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="keepalive" className={styles.label}>
              Keepalive Interval
            </label>
            <div className={styles.numberInputRow}>
              <input
                id="keepalive"
                type="number"
                className={styles.input}
                value={formData.keepaliveIntervalSecs}
                onChange={(e) =>
                  updateField('keepaliveIntervalSecs', parseInt(e.target.value, 10) || 60)
                }
                min={0}
                max={3600}
              />
              <span className={styles.unitLabel}>seconds</span>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Color picker */}
      <div className={styles.colorRow}>
        <span className={styles.label}>Color</span>
        <ColorPickerPopover
          color={formData.color}
          onChange={(color) => updateField('color', color)}
        />
      </div>

      {/* Group selector */}
      <div className={styles.fieldGroup}>
        <label htmlFor="conn-group" className={styles.label}>
          Group
        </label>
        <select
          id="conn-group"
          className={styles.select}
          value={formData.groupId ?? ''}
          onChange={(e) => updateField('groupId', e.target.value || null)}
        >
          <option value="">Ungrouped</option>
          {connectionGroups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </div>

      {/* Action buttons */}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => void handleTestConnection()}
          disabled={isAnyPending}
        >
          {pendingAction === 'test' ? 'Testing...' : 'Test Connection'}
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => void handleSave()}
          disabled={isAnyPending}
        >
          {pendingAction === 'save' ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => void handleConnect()}
          disabled={isAnyPending}
        >
          {pendingAction === 'connect' ? 'Connecting...' : 'Connect'}
        </button>
      </div>

      {/* Test connection result */}
      <TestConnectionResult result={testResult} />
    </form>
  )
}
