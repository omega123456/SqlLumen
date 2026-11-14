import { useCallback, useMemo, useState } from 'react'
import { useConnectionStore } from '../../stores/connection-store'
import { UnderlineTabBar, UnderlineTab } from '../common/UnderlineTabs'
import { ConfirmDialog } from '../dialogs/ConfirmDialog'
import { TestConnectionResult } from './TestConnectionResult'
import type { ConnectionFormData, SavedConnection } from '../../types/connection'
import styles from './ConnectionForm.module.css'
import {
  TAB_ORDER,
  tabHasError,
  type ConnectionFormSeed,
  type FormErrors,
  type FormTab,
} from './connection-editor-state'
import { useConnectionFormActions } from './useConnectionFormActions'
import type { FormFields, PasswordControls } from './connection-form/form-fields'
import { GeneralPanel } from './connection-form/GeneralPanel'
import { SslPanel } from './connection-form/SslPanel'
import { AdvancedPanel } from './connection-form/AdvancedPanel'
import { ConnectionFormFooter } from './connection-form/ConnectionFormFooter'

export type { ConnectionFormSeed }

interface ConnectionFormProps {
  editingConnection?: SavedConnection
  onDeleteConnection?: (id: string) => void
  initialData?: ConnectionFormSeed
}

const TAB_LABELS: Record<FormTab, string> = {
  general: 'General',
  ssl: 'SSL',
  advanced: 'Advanced',
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

interface ConnectionFormTabsProps {
  activeTab: FormTab
  errors: FormErrors
  onSelectTab: (tab: FormTab) => void
}

function ConnectionFormTabs({ activeTab, errors, onSelectTab }: ConnectionFormTabsProps) {
  return (
    <UnderlineTabBar data-testid="connection-form-tabs">
      {TAB_ORDER.map((tab) => (
        <UnderlineTab
          key={tab}
          active={activeTab === tab}
          onClick={() => onSelectTab(tab)}
          data-testid={`connection-form-tab-${tab}`}
        >
          {TAB_LABELS[tab]}
          {tabHasError(errors, tab) && (
            <span className={styles.tabErrorDot} aria-label="Has errors" />
          )}
        </UnderlineTab>
      ))}
    </UnderlineTabBar>
  )
}

type ConnectionFormController = ReturnType<typeof useConnectionFormActions>

function useGroupDropdownOptions() {
  const connectionGroups = useConnectionStore((state) => state.connectionGroups)
  return useMemo(
    () => [
      { value: '', label: 'Ungrouped' },
      ...connectionGroups.map((group) => ({ value: group.id, label: group.name })),
    ],
    [connectionGroups]
  )
}

interface ActiveTabPanelProps {
  form: ConnectionFormController
  password: PasswordControls
}

function ActiveTabPanel({ form, password }: ActiveTabPanelProps) {
  const { formData, errors, activeTab } = form.editor
  const nameAutoFocus = useNameAutoFocus(activeTab)
  const groupDropdownOptions = useGroupDropdownOptions()
  const fields: FormFields = {
    formData: formData,
    errors: errors,
    updateField: form.updateField,
  }

  if (activeTab === 'general') {
    return <GeneralPanel fields={fields} nameAutoFocus={nameAutoFocus} password={password} />
  }
  if (activeTab === 'ssl') {
    return <SslPanel fields={fields} onBrowseFile={(field) => void form.browseSslFile(field)} />
  }
  return <AdvancedPanel fields={fields} groupDropdownOptions={groupDropdownOptions} />
}

function usePasswordControls(form: ConnectionFormController, hintInputs: DuplicateHintInputs) {
  const [showPassword, setShowPassword] = useState(false)
  const { hasSavedPassword, clearSavedPassword } = form.editor
  return {
    showPassword: showPassword,
    hasSavedPassword: hasSavedPassword,
    clearSavedPassword: clearSavedPassword,
    showDuplicateHint: shouldShowDuplicatePasswordHint(hintInputs),
    onPasswordChange: form.changePassword,
    onToggleShowPassword: () => setShowPassword((previous) => !previous),
    onClearSavedPasswordChange: form.changeClearSavedPassword,
  }
}

function DeleteConnectionConfirm({
  form,
  portalRoot,
}: {
  form: ConnectionFormController
  portalRoot: HTMLElement | null
}) {
  const { deleteConfirm, formData } = form.editor
  const isDeleting = form.pendingAction === 'delete'
  return (
    <ConfirmDialog
      isOpen={deleteConfirm !== null}
      title="Delete connection"
      message={
        <>
          Delete saved connection <strong>{deleteTargetName(formData)}</strong>?
        </>
      }
      portalRoot={portalRoot}
      confirmLabel="Delete"
      isDestructive
      isLoading={isDeleting}
      error={deleteConfirm?.error ?? null}
      nonDismissible={isDeleting}
      onConfirm={() => void form.deleteCurrentConnection()}
      onCancel={form.cancelDeleteConfirm}
    />
  )
}

export function ConnectionForm({
  editingConnection,
  onDeleteConnection,
  initialData,
}: ConnectionFormProps) {
  const [dialogPortalRoot, setDialogPortalRoot] = useState<HTMLElement | null>(null)
  const form = useConnectionFormActions({
    editingConnection: editingConnection,
    initialData: initialData,
    onDeleteConnection: onDeleteConnection,
  })
  const { formData, errors, activeTab, testResult, savedId } = form.editor
  const password = usePasswordControls(form, {
    editingConnection: editingConnection,
    savedId: savedId,
    initialData: initialData,
  })

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
          <ConnectionFormTabs activeTab={activeTab} errors={errors} onSelectTab={form.selectTab} />
          {testResult ? (
            <div className={styles.testResultSlot}>
              <TestConnectionResult result={testResult} />
            </div>
          ) : null}
          <ActiveTabPanel form={form} password={password} />
        </form>
      </div>

      <ConnectionFormFooter
        pendingAction={form.pendingAction}
        canDelete={form.currentConnectionId !== null}
        onTest={() => void form.runTestConnection()}
        onDeleteRequest={form.requestDelete}
        onConnect={() => void form.connect()}
        onSave={() => void form.save()}
      />
      <DeleteConnectionConfirm form={form} portalRoot={dialogPortalRoot} />
    </div>
  )
}
