import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
  type RefObject,
} from 'react'
import { Warning, Info } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { TextInput } from '../common/TextInput'
import { Checkbox } from '../common/Checkbox'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { DialogShell } from './DialogShell'
import {
  listCopyableObjects,
  startCopyToHost,
  getCopyProgress,
  cancelCopy,
  assembleCopyObjects,
  countCopySelection,
  createEmptyCopySelection,
  COPY_OBJECT_CATEGORY_LABELS,
  COPY_OBJECT_CATEGORY_ORDER,
  type CopyableObjects,
  type CopyToHostOptions,
  type CopyProgress,
  type CopyInsertMode,
  type CopyObjectCategory,
  type CopyObjectSelection,
} from '../../lib/copy-to-host-commands'
import { listDatabases } from '../../lib/schema-commands'
import { useConnectionStore } from '../../stores/connection-store'
import { showSuccessToast, showErrorToast } from '../../stores/toast-store'
import { logFrontendError } from '../../lib/app-log-commands'
import styles from './CopyToHostDialog.module.css'
import { isCancelInFlight, isTerminalJobStatus, progressPercent } from '../../lib/job-progress'
import { useJobProgressPolling } from '../../hooks/useJobProgressPolling'
import { toErrorMessage } from '../../lib/error-message'
import { isPlaywrightBuild } from '../../lib/tauri-env'

// Skip focus management in deterministic test environments (Playwright + Vitest/jsdom) so the
// focus trap's rAF-driven focus restoration cannot interfere with portalled dropdown interactions.
const skipFocusManagement = isPlaywrightBuild() || import.meta.env.VITEST === true

/** Sentinel value used by the target database dropdown to mean "create a new database". */
const NEW_DB_SENTINEL = '__new__'

/** Copy type controls which of structure / data are transferred. */
type CopyType = 'both' | 'structureOnly' | 'dataOnly'

const CATEGORY_LABELS = COPY_OBJECT_CATEGORY_LABELS
const CATEGORY_ORDER = COPY_OBJECT_CATEGORY_ORDER

const COPY_TYPE_OPTIONS: DropdownOption[] = [
  { value: 'both', label: 'Structure + data' },
  { value: 'structureOnly', label: 'Structure only' },
  { value: 'dataOnly', label: 'Data only' },
]

const INSERT_MODE_OPTIONS: DropdownOption[] = [
  { value: 'insert', label: 'INSERT' },
  { value: 'insertIgnore', label: 'INSERT IGNORE' },
  { value: 'replace', label: 'REPLACE INTO' },
]

function normalizeHost(host: string | null | undefined): string | null {
  const normalized = host?.trim().toLowerCase()
  return normalized ? normalized : null
}

/** Static elevated-surface section card — a titled panel (no collapse behavior). */
function Section({
  title,
  testId,
  children,
}: {
  title: string
  testId?: string
  children: ReactNode
}) {
  return (
    <section className={styles.section} data-testid={testId}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  )
}

export interface CopyToHostDialogProps {
  isOpen: boolean
  onClose: () => void
  sourceConnectionId: string
  sourceConnectionLabel: string
  sourceDatabase: string
  /** Optional object pre-selected from a single-object context menu launch. */
  preSelectedObject?: CopyObjectSelection
}

/** Return the list of object names within a category from the loaded enumeration. */
function categoryNames(objects: CopyableObjects, category: CopyObjectCategory): string[] {
  if (category === 'tables') {
    return objects.tables.map((table) => table.name)
  }
  return objects[category]
}

interface CopyDialogOptions {
  copyType: CopyType
  dropIfExists: boolean
  createIfNotExists: boolean
  insertMode: CopyInsertMode
  truncateBeforeInsert: boolean
  ignoreDefiner: boolean
}

const DEFAULT_COPY_OPTIONS: CopyDialogOptions = {
  copyType: 'both',
  dropIfExists: true,
  createIfNotExists: true,
  insertMode: 'insert',
  truncateBeforeInsert: false,
  ignoreDefiner: true,
}

type UpdateCopyOption = <Key extends keyof CopyDialogOptions>(
  key: Key,
  value: CopyDialogOptions[Key]
) => void

function toCopyToHostOptions(options: CopyDialogOptions): CopyToHostOptions {
  return {
    copyStructure: options.copyType !== 'dataOnly',
    copyData: options.copyType !== 'structureOnly',
    dropIfExists: options.dropIfExists,
    createIfNotExists: options.createIfNotExists,
    truncateBeforeInsert: options.truncateBeforeInsert,
    insertMode: options.insertMode,
    ignoreDefiner: options.ignoreDefiner,
  }
}

interface PreselectionKey {
  category: CopyObjectCategory | null
  name: string | null
}

function preselectionKey(preSelectedObject: CopyObjectSelection | undefined): PreselectionKey {
  if (!preSelectedObject) return { category: null, name: null }
  return { category: preSelectedObject.category, name: preSelectedObject.name }
}

function initialExpandedCategories(
  preSelectedCategory: CopyObjectCategory | null
): Set<CopyObjectCategory> {
  if (!preSelectedCategory) return new Set()
  return new Set([preSelectedCategory])
}

function toggledSetMember<Member>(members: Set<Member>, member: Member): Set<Member> {
  const next = new Set(members)
  if (next.has(member)) {
    next.delete(member)
    return next
  }
  next.add(member)
  return next
}

function objectCountText(count: number): string {
  return `${count} ${count === 1 ? 'object' : 'objects'}`
}

function objectsSectionTitle(selectedCount: number): string {
  if (selectedCount === 0) return 'Objects'
  return `Objects (${selectedCount})`
}

interface CopyReadinessInputs {
  targetConnectionId: string
  targetDatabase: string
  selectedCount: number
  isCopying: boolean
}

function canStartCopy(inputs: CopyReadinessInputs): boolean {
  if (!inputs.targetConnectionId) return false
  if (!inputs.targetDatabase) return false
  return inputs.selectedCount > 0 && !inputs.isCopying
}

function dimmedWhen(isDimmed: boolean): string {
  if (!isDimmed) return styles.optionGroup
  return `${styles.optionGroup} ${styles.dimmed}`
}

interface CopyTargetState {
  connectionOptions: DropdownOption[]
  connectionId: string
  databaseOptions: DropdownOption[]
  databaseValue: string
  newDatabaseName: string
  notice: string | null
  isSameHost: boolean
}

interface CopyTargetHandlers {
  onConnectionChange: (connectionId: string) => void
  onDatabaseChange: (value: string) => void
  onNewDatabaseNameChange: (name: string) => void
}

interface CopyTargetSectionProps {
  target: CopyTargetState
  newDatabaseInputRef: RefObject<HTMLInputElement | null>
  handlers: CopyTargetHandlers
}

function CopyTargetSection({ target, newDatabaseInputRef, handlers }: CopyTargetSectionProps) {
  return (
    <Section title="Target" testId="copy-target-section">
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} id="copy-target-connection-label">
          Connection
        </label>
        <Dropdown
          id="copy-target-connection"
          labelledBy="copy-target-connection-label"
          options={target.connectionOptions}
          value={target.connectionId}
          onChange={handlers.onConnectionChange}
          data-testid="copy-target-connection"
        />
      </div>
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} id="copy-target-database-label">
          Database
        </label>
        <Dropdown
          id="copy-target-database"
          labelledBy="copy-target-database-label"
          options={target.databaseOptions}
          value={target.databaseValue}
          disabled={!target.connectionId}
          onChange={handlers.onDatabaseChange}
          data-testid="copy-target-database"
        />
        {target.databaseValue === NEW_DB_SENTINEL && (
          <div className={styles.newDbGroup}>
            <TextInput
              ref={newDatabaseInputRef}
              value={target.newDatabaseName}
              onChange={(event) => handlers.onNewDatabaseNameChange(event.target.value)}
              placeholder="new_database_name"
              aria-label="New database name"
              data-testid="copy-new-database-name"
            />
          </div>
        )}
        {target.notice && (
          <p className={styles.infoNote} data-testid="copy-target-database-notice">
            <Info size={14} weight="fill" className={styles.infoIcon} />
            {target.notice}
          </p>
        )}
      </div>
      {target.isSameHost && (
        <p className={styles.warningNote} data-testid="copy-same-host-warning">
          <Warning size={14} weight="fill" className={styles.warningIcon} />
          The target resolves to the same host as the source. Choose a different host.
        </p>
      )}
    </Section>
  )
}

interface CopyObjectTreeProps {
  objects: CopyableObjects | null
  selected: Record<CopyObjectCategory, Set<string>>
  expandedCategories: Set<CopyObjectCategory>
  onToggleExpanded: (category: CopyObjectCategory) => void
  onToggleCategory: (category: CopyObjectCategory) => void
  onToggleObject: (category: CopyObjectCategory, name: string) => void
}

interface CopyObjectCategoryGroupProps {
  category: CopyObjectCategory
  names: string[]
  tree: CopyObjectTreeProps
}

function CopyObjectCategoryGroup({ category, names, tree }: CopyObjectCategoryGroupProps) {
  const selectedSet = tree.selected[category]
  const isEmpty = names.length === 0
  const allSelected = !isEmpty && selectedSet.size === names.length
  const someSelected = selectedSet.size > 0 && !allSelected
  const isExpanded = tree.expandedCategories.has(category)
  const expandVerb = isExpanded ? 'Collapse' : 'Expand'
  const caretClassName = isExpanded ? `${styles.caret} ${styles.caretOpen}` : styles.caret

  return (
    <div className={styles.objectCategory}>
      <div className={styles.objectCategoryHeader}>
        <Button
          variant="subtle"
          size="sm"
          className={styles.caretButton}
          onClick={() => tree.onToggleExpanded(category)}
          aria-expanded={isExpanded}
          aria-label={`${expandVerb} ${CATEGORY_LABELS[category]}`}
          data-testid={`copy-category-toggle-${category}`}
        >
          <svg
            className={caretClassName}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </Button>
        <Checkbox
          checked={allSelected}
          disabled={isEmpty}
          ref={(element) => {
            if (element) element.indeterminate = someSelected
          }}
          onChange={() => tree.onToggleCategory(category)}
          aria-label={`Select all ${CATEGORY_LABELS[category]}`}
          data-testid={`copy-category-${category}`}
        />
        <span className={styles.objectCategoryLabel}>{CATEGORY_LABELS[category]}</span>
        <span className={styles.objectCategoryCount}>({names.length})</span>
      </div>
      {isExpanded && !isEmpty && (
        <div className={styles.objectItems}>
          {names.map((name) => (
            <div key={name} className={styles.objectItem}>
              <Checkbox
                checked={selectedSet.has(name)}
                onChange={() => tree.onToggleObject(category, name)}
                aria-label={name}
                data-testid={`copy-object-${category}-${name}`}
              />
              <span className={styles.objectItemLabel}>{name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface CopyObjectsBodyProps {
  loadingObjects: boolean
  loadError: string | null
  tree: CopyObjectTreeProps
}

function CopyObjectsBody({ loadingObjects, loadError, tree }: CopyObjectsBodyProps) {
  const objects = tree.objects
  return (
    <>
      {loadingObjects && (
        <div className={styles.loading} data-testid="copy-loading-objects">
          Loading objects…
        </div>
      )}
      {loadError && (
        <div className={styles.error} data-testid="copy-load-error">
          {loadError}
        </div>
      )}
      {!loadingObjects && !loadError && objects && (
        <div className={styles.objectTree} data-testid="copy-object-tree">
          {CATEGORY_ORDER.map((category) => (
            <CopyObjectCategoryGroup
              key={category}
              category={category}
              names={categoryNames(objects, category)}
              tree={tree}
            />
          ))}
        </div>
      )}
    </>
  )
}

interface CopyOptionsSectionProps {
  options: CopyDialogOptions
  onOptionChange: UpdateCopyOption
}

function CopyOptionsSection({ options, onOptionChange }: CopyOptionsSectionProps) {
  const structureDisabled = options.copyType === 'dataOnly'
  const dataDisabled = options.copyType === 'structureOnly'
  return (
    <Section title="Options" testId="copy-options-section">
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} id="copy-type-label">
          Copy type
        </label>
        <Dropdown
          id="copy-type"
          labelledBy="copy-type-label"
          options={COPY_TYPE_OPTIONS}
          value={options.copyType}
          onChange={(value) => onOptionChange('copyType', value as CopyType)}
          data-testid="copy-type"
        />
      </div>

      <div
        className={dimmedWhen(structureDisabled)}
        aria-disabled={structureDisabled}
        data-testid="copy-structure-group"
      >
        <span className={styles.optionGroupLabel}>Structure</span>
        <div className={`${styles.checkboxRow} ${styles.warningAccent}`}>
          <Warning size={14} weight="fill" className={styles.warningIcon} />
          <Checkbox
            id="copy-drop-if-exists"
            checked={options.dropIfExists}
            disabled={structureDisabled}
            onChange={(event) => onOptionChange('dropIfExists', event.target.checked)}
            data-testid="copy-drop-if-exists"
          />
          <label htmlFor="copy-drop-if-exists" className={styles.checkboxLabel}>
            DROP … IF EXISTS first
          </label>
        </div>
        <div className={styles.checkboxRow}>
          <Checkbox
            id="copy-create-if-not-exists"
            checked={options.createIfNotExists}
            disabled={structureDisabled}
            onChange={(event) => onOptionChange('createIfNotExists', event.target.checked)}
            data-testid="copy-create-if-not-exists"
          />
          <label htmlFor="copy-create-if-not-exists" className={styles.checkboxLabel}>
            CREATE TABLE IF NOT EXISTS
          </label>
        </div>
        {structureDisabled && (
          <p className={styles.notApplicable} data-testid="copy-structure-na">
            Not applicable for Data only
          </p>
        )}
      </div>

      <div className={styles.divider} role="separator" />

      <div
        className={dimmedWhen(dataDisabled)}
        aria-disabled={dataDisabled}
        data-testid="copy-data-group"
      >
        <span className={styles.optionGroupLabel}>Data</span>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} id="copy-insert-mode-label">
            Insert mode
          </label>
          <Dropdown
            id="copy-insert-mode"
            labelledBy="copy-insert-mode-label"
            options={INSERT_MODE_OPTIONS}
            value={options.insertMode}
            disabled={dataDisabled}
            onChange={(value) => onOptionChange('insertMode', value as CopyInsertMode)}
            data-testid="copy-insert-mode"
          />
        </div>
        <div className={`${styles.checkboxRow} ${styles.warningAccent}`}>
          <Warning size={14} weight="fill" className={styles.warningIcon} />
          <Checkbox
            id="copy-truncate"
            checked={options.truncateBeforeInsert}
            disabled={dataDisabled}
            onChange={(event) => onOptionChange('truncateBeforeInsert', event.target.checked)}
            data-testid="copy-truncate"
          />
          <label htmlFor="copy-truncate" className={styles.checkboxLabel}>
            Truncate target table before insert
          </label>
        </div>
        {dataDisabled && (
          <p className={styles.notApplicable} data-testid="copy-data-na">
            Not applicable for Structure only
          </p>
        )}
      </div>

      <div className={styles.divider} role="separator" />

      <div className={styles.checkboxRow}>
        <Checkbox
          id="copy-ignore-definer"
          checked={options.ignoreDefiner}
          onChange={(event) => onOptionChange('ignoreDefiner', event.target.checked)}
          data-testid="copy-ignore-definer"
        />
        <label htmlFor="copy-ignore-definer" className={styles.checkboxLabel}>
          Ignore Definer (strip DEFINER from routines/triggers/events)
        </label>
      </div>
    </Section>
  )
}

function isRunningTableWithKnownRows(progress: CopyProgress): boolean {
  if (progress.status !== 'running') return false
  return progress.currentObjectType === 'table' && Boolean(progress.rowsTotal)
}

function isRunningObjectWithType(progress: CopyProgress): boolean {
  if (progress.status !== 'running') return false
  return Boolean(progress.currentObject) && Boolean(progress.currentObjectType)
}

function CurrentObjectDetail({ progress }: { progress: CopyProgress }) {
  if (isRunningTableWithKnownRows(progress)) {
    return (
      <span className={styles.progressCount} data-testid="copy-row-count">
        {(progress.rowsDone ?? 0).toLocaleString()} / {(progress.rowsTotal ?? 0).toLocaleString()}
      </span>
    )
  }
  if (isRunningObjectWithType(progress)) {
    return (
      <span className={styles.typeBadge} data-testid="copy-type-badge">
        {progress.currentObjectType}
      </span>
    )
  }
  return null
}

function CopyOutcomeStatus({ progress }: { progress: CopyProgress }) {
  if (progress.status === 'completed') {
    return (
      <p className={styles.statusSuccess} data-testid="copy-status-success">
        Completed — {objectCountText(progress.objectsDone)} copied
      </p>
    )
  }
  if (progress.status === 'cancelled') {
    return (
      <p className={styles.statusCancel} data-testid="copy-status-cancel">
        Cancelled — {progress.objectsDone} of {progress.objectsTotal} objects copied
      </p>
    )
  }
  if (progress.status !== 'failed') return null
  const failedObjectSuffix = progress.currentObject ? ` on ${progress.currentObject}` : ''
  return (
    <div className={styles.statusError} data-testid="copy-status-error">
      Failed
      {failedObjectSuffix}:
      <br />
      {progress.errorMessage ?? 'Unknown error'}
    </div>
  )
}

function CopyProgressPanel({ progress }: { progress: CopyProgress }) {
  const objectsPercent = progressPercent(progress.objectsDone, progress.objectsTotal)
  const rowsPercent = progressPercent(progress.rowsDone, progress.rowsTotal)
  return (
    <div className={styles.progressSection} data-testid="copy-progress">
      <div className={styles.progressRow}>
        <span className={styles.progressLabel}>Objects</span>
        <div className={styles.macroBar}>
          <div className={styles.macroFill} style={{ width: `${objectsPercent}%` }} />
        </div>
        <span className={styles.progressCount}>
          {progress.objectsDone} / {progress.objectsTotal}
        </span>
      </div>

      {progress.currentObject && (
        <div className={styles.progressRow}>
          <span className={styles.currentObjectName}>{progress.currentObject}</span>
          <CurrentObjectDetail progress={progress} />
        </div>
      )}

      {isRunningTableWithKnownRows(progress) && (
        <div className={styles.microBar}>
          <div className={styles.microFill} style={{ width: `${rowsPercent}%` }} />
        </div>
      )}

      <CopyOutcomeStatus progress={progress} />
    </div>
  )
}

interface CopyFooterHandlers {
  onClose: () => void
  onCancel: () => void
  onCopy: () => void
}

interface CopyFooterActionsProps {
  showProgress: boolean
  isTerminal: boolean
  isCancelling: boolean
  canCopy: boolean
  handlers: CopyFooterHandlers
}

function progressActionLabel(isTerminal: boolean, isCancelling: boolean): string {
  if (isTerminal) return 'Close'
  if (isCancelling) return 'Cancelling…'
  return 'Cancel'
}

function CopyFooterActions({
  showProgress,
  isTerminal,
  isCancelling,
  canCopy,
  handlers,
}: CopyFooterActionsProps) {
  if (showProgress) {
    return (
      <div className={styles.footerActions}>
        <Button
          variant={isTerminal ? 'default' : 'danger'}
          onClick={isTerminal ? handlers.onClose : handlers.onCancel}
          disabled={!isTerminal && isCancelling}
          data-testid="copy-progress-action"
        >
          {progressActionLabel(isTerminal, isCancelling)}
        </Button>
      </div>
    )
  }
  return (
    <div className={styles.footerActions}>
      <Button
        variant="accent"
        onClick={handlers.onCopy}
        disabled={!canCopy}
        data-testid="copy-submit-button"
      >
        Copy
      </Button>
      <Button onClick={handlers.onClose} data-testid="copy-cancel-button">
        Cancel
      </Button>
    </div>
  )
}

export default function CopyToHostDialog({
  isOpen,
  onClose,
  sourceConnectionId,
  sourceConnectionLabel,
  sourceDatabase,
  preSelectedObject,
}: CopyToHostDialogProps) {
  const savedConnections = useConnectionStore((state) => state.savedConnections)
  const activeConnections = useConnectionStore((state) => state.activeConnections)

  // Target selection
  const [targetConnectionId, setTargetConnectionId] = useState('')
  const [targetDatabaseValue, setTargetDatabaseValue] = useState('')
  const [newDatabaseName, setNewDatabaseName] = useState('')
  const [targetDatabases, setTargetDatabases] = useState<string[]>([])
  const [targetDatabaseNotice, setTargetDatabaseNotice] = useState<string | null>(null)

  // Objects
  const [objects, setObjects] = useState<CopyableObjects | null>(null)
  const [loadingObjects, setLoadingObjects] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState(createEmptyCopySelection)
  const [expandedCategories, setExpandedCategories] = useState<Set<CopyObjectCategory>>(() =>
    initialExpandedCategories(preSelectedObject?.category ?? null)
  )

  const [copyOptions, setCopyOptions] = useState<CopyDialogOptions>(DEFAULT_COPY_OPTIONS)

  // Copy run state
  const [isCopying, setIsCopying] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<CopyProgress | null>(null)
  const [cancelPending, setCancelPending] = useState(false)

  const newDbInputRef = useRef<HTMLInputElement>(null)

  // Capture the pre-selected object's primitive fields so the load effect depends on stable values
  // (not a fresh object reference on every render).
  const { category: preSelectedCategory, name: preSelectedName } =
    preselectionKey(preSelectedObject)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setTargetConnectionId('')
    setTargetDatabaseValue('')
    setNewDatabaseName('')
    setTargetDatabases([])
    setTargetDatabaseNotice(null)
    setSelected(createEmptyCopySelection())
    setExpandedCategories(initialExpandedCategories(preSelectedCategory))
    setCopyOptions(DEFAULT_COPY_OPTIONS)
    setIsCopying(false)
    setJobId(null)
    setProgress(null)
    setCancelPending(false)
  }, [isOpen, preSelectedCategory])

  // Resolve the source host so we can exclude it (and read-only profiles) from the target picker.
  const sourceHost = useMemo(() => {
    const active = activeConnections[sourceConnectionId]
    return normalizeHost(active?.profile.host)
  }, [activeConnections, sourceConnectionId])

  const activeTargetSessionId = useMemo(() => {
    if (!targetConnectionId) return null
    const active = Object.values(activeConnections).find(
      (connection) => connection.profile.id === targetConnectionId
    )
    return active?.id ?? null
  }, [activeConnections, targetConnectionId])

  // Load copyable objects from the source on mount.
  useEffect(() => {
    let cancelled = false

    // Wrapped in an inner async function so the loading/reset setState calls are not synchronous
    // statements in the effect body (avoids cascading-render lint while keeping the same behavior).
    const loadObjects = async () => {
      setLoadingObjects(true)
      setLoadError(null)
      try {
        const result = await listCopyableObjects(sourceConnectionId, sourceDatabase)
        if (cancelled) return
        setObjects(result)
        // Expand all non-empty categories by default (plus any pre-selected category) so the
        // objects are visible; empty categories stay collapsed.
        setExpandedCategories((previous) => {
          const next = new Set(previous)
          for (const category of CATEGORY_ORDER) {
            if (categoryNames(result, category).length > 0) next.add(category)
          }
          return next
        })
        if (preSelectedCategory && preSelectedName) {
          const names = categoryNames(result, preSelectedCategory)
          if (names.includes(preSelectedName)) {
            setSelected((previous) => {
              const next = { ...previous }
              next[preSelectedCategory] = new Set([preSelectedName])
              return next
            })
          }
        }
      } catch (error) {
        if (cancelled) return
        const message = toErrorMessage(error)
        setLoadError(message)
        logFrontendError('[copy-to-host] Failed to load copyable objects:', message)
        showErrorToast('Failed to load copyable objects', message)
      } finally {
        if (!cancelled) setLoadingObjects(false)
      }
    }

    void loadObjects()

    return () => {
      cancelled = true
    }
  }, [sourceConnectionId, sourceDatabase, preSelectedCategory, preSelectedName])

  // Load the target's databases when a target connection is chosen.
  useEffect(() => {
    let cancelled = false

    const loadDatabases = async () => {
      if (!targetConnectionId) {
        setTargetDatabases([])
        setTargetDatabaseNotice(null)
        return
      }

      if (!activeTargetSessionId) {
        setTargetDatabases([])
        setTargetDatabaseNotice(
          'Open this target connection first to list existing databases, or choose “+ New database…”.'
        )
        return
      }

      try {
        const dbs = await listDatabases(activeTargetSessionId)
        if (cancelled) return
        setTargetDatabases(dbs)
        setTargetDatabaseNotice(null)
        // Default to a target database matching the source name when one exists, but never
        // overwrite a selection the user has already made.
        if (dbs.includes(sourceDatabase)) {
          setTargetDatabaseValue((previous) => (previous === '' ? sourceDatabase : previous))
        }
      } catch (error) {
        if (cancelled) return
        const message = toErrorMessage(error)
        setTargetDatabases([])
        setTargetDatabaseNotice(null)
        logFrontendError('[copy-to-host] Failed to load target databases:', message)
        showErrorToast(`Failed to load target databases: ${message}`)
      }
    }

    void loadDatabases()

    return () => {
      cancelled = true
    }
  }, [targetConnectionId, activeTargetSessionId, sourceDatabase])

  // Auto-focus the new-database name field when the sentinel option is chosen.
  useEffect(() => {
    if (targetDatabaseValue === NEW_DB_SENTINEL) {
      newDbInputRef.current?.focus()
    }
  }, [targetDatabaseValue])

  const handleCopyFinished = (finishedProgress: CopyProgress) => {
    setIsCopying(false)
    if (finishedProgress.status === 'completed') {
      showSuccessToast('Copy completed', `${objectCountText(finishedProgress.objectsDone)} copied`)
      return
    }
    if (finishedProgress.status === 'cancelled') {
      setCancelPending(false)
      return
    }
    showErrorToast('Copy failed', finishedProgress.errorMessage ?? 'Copy to host failed')
  }

  useJobProgressPolling({
    jobId: jobId,
    fetchProgress: getCopyProgress,
    onProgress: setProgress,
    onFinished: handleCopyFinished,
    pollFailureMessage: '[copy-to-host] Failed to poll progress:',
  })

  // Target connection options exclude the source host and any read-only connection.
  const targetConnectionOptions = useMemo<DropdownOption[]>(() => {
    const options = savedConnections
      .filter((connection) => !connection.readOnly)
      .filter((connection) => sourceHost === null || normalizeHost(connection.host) !== sourceHost)
      .map((connection) => ({
        value: connection.id,
        label: connection.name,
        description: `${connection.host}:${connection.port}`,
      }))
    return [{ value: '', label: 'Select a connection…' }, ...options]
  }, [savedConnections, sourceHost])

  // Database dropdown options: existing databases + the "+ New database…" sentinel.
  const targetDatabaseOptions = useMemo<DropdownOption[]>(() => {
    const options: DropdownOption[] = [{ value: '', label: 'Select a database…' }]
    for (const db of targetDatabases) {
      options.push({ value: db, label: db })
    }
    options.push({
      value: NEW_DB_SENTINEL,
      label: '+ New database…',
      description: 'Create a new database on the target',
    })
    return options
  }, [targetDatabases])

  // The same-host guard: warn if the chosen target resolves to the source host.
  const targetIsSameHost = useMemo(() => {
    if (!targetConnectionId || sourceHost === null) return false
    const target = savedConnections.find((connection) => connection.id === targetConnectionId)
    return normalizeHost(target?.host) === sourceHost
  }, [savedConnections, targetConnectionId, sourceHost])

  // The effective target database name (existing selection or the typed new name).
  const effectiveTargetDatabase = useMemo(() => {
    if (targetDatabaseValue === NEW_DB_SENTINEL) return newDatabaseName.trim()
    return targetDatabaseValue
  }, [targetDatabaseValue, newDatabaseName])

  const selectedCount = useMemo(() => countCopySelection(selected), [selected])

  const canCopy = canStartCopy({
    targetConnectionId: targetConnectionId,
    targetDatabase: effectiveTargetDatabase,
    selectedCount: selectedCount,
    isCopying: isCopying,
  })

  // Toggle a single object within a category.
  const toggleObject = useCallback((category: CopyObjectCategory, name: string) => {
    setSelected((previous) => ({
      ...previous,
      [category]: toggledSetMember(previous[category], name),
    }))
  }, [])

  // Toggle all objects within a category (select-all checkbox).
  const toggleCategory = useCallback(
    (category: CopyObjectCategory) => {
      if (!objects) return
      const names = categoryNames(objects, category)
      setSelected((previous) => {
        const next = { ...previous }
        next[category] = previous[category].size === names.length ? new Set() : new Set(names)
        return next
      })
    },
    [objects]
  )

  const toggleCategoryExpanded = useCallback((category: CopyObjectCategory) => {
    setExpandedCategories((previous) => toggledSetMember(previous, category))
  }, [])

  // Start the copy job.
  const handleCopy = useCallback(async () => {
    if (!canCopy) return
    setIsCopying(true)
    setProgress(null)

    const copyObjects = assembleCopyObjects(selected)

    const options = toCopyToHostOptions(copyOptions)

    try {
      const id = await startCopyToHost({
        sourceConnectionId: sourceConnectionId,
        sourceDatabase: sourceDatabase,
        targetConnectionId: targetConnectionId,
        targetDatabase: effectiveTargetDatabase,
        objects: copyObjects,
        options: options,
      })
      setJobId(id)
    } catch (error) {
      setIsCopying(false)
      const message = toErrorMessage(error)
      showErrorToast('Copy failed', message)
      logFrontendError('[copy-to-host] Failed to start copy:', message)
    }
  }, [
    canCopy,
    selected,
    copyOptions,
    sourceConnectionId,
    sourceDatabase,
    targetConnectionId,
    effectiveTargetDatabase,
  ])

  // Cancel a running copy.
  const handleCancel = useCallback(async () => {
    if (!jobId || cancelPending) return
    setCancelPending(true)
    try {
      await cancelCopy(jobId)
    } catch (error) {
      setCancelPending(false)
      const message = toErrorMessage(error)
      logFrontendError('[copy-to-host] Failed to cancel copy:', message)
      showErrorToast('Failed to cancel copy', message)
    }
  }, [jobId, cancelPending])

  const isTerminal = isTerminalJobStatus(progress?.status)
  const showProgress = isCopying || progress !== null

  const updateCopyOption = useCallback(
    <Key extends keyof CopyDialogOptions>(key: Key, value: CopyDialogOptions[Key]) => {
      setCopyOptions((previous) => ({ ...previous, [key]: value }))
    },
    []
  )

  const handleTargetConnectionChange = (connectionId: string) => {
    setTargetConnectionId(connectionId)
    setTargetDatabaseValue('')
    setNewDatabaseName('')
  }

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      panelWidth="min(72vw, 1240px)"
      panelHeight="min(92vh, max(70vh, 820px))"
      panelPadding={false}
      testId="copy-to-host-dialog"
      ariaLabel="Copy to another host"
      disableFocusManagement={skipFocusManagement}
      nonDismissible={isCopying}
    >
      <div className={styles.root}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Copy to another host</h2>
          {!isCopying && (
            <Button
              variant="subtle"
              size="sm"
              className={styles.closeButton}
              onClick={onClose}
              aria-label="Close"
              data-testid="copy-close-button"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </Button>
          )}
        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* Source */}
          <Section title="Source" testId="copy-source-section">
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} htmlFor="copy-source-connection">
                Connection
              </label>
              <TextInput
                id="copy-source-connection"
                value={sourceConnectionLabel}
                disabled
                readOnly
                data-testid="copy-source-connection"
              />
            </div>
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} htmlFor="copy-source-database">
                Database
              </label>
              <TextInput
                id="copy-source-database"
                value={sourceDatabase}
                disabled
                readOnly
                data-testid="copy-source-database"
              />
            </div>
          </Section>

          <CopyTargetSection
            target={{
              connectionOptions: targetConnectionOptions,
              connectionId: targetConnectionId,
              databaseOptions: targetDatabaseOptions,
              databaseValue: targetDatabaseValue,
              newDatabaseName: newDatabaseName,
              notice: targetDatabaseNotice,
              isSameHost: targetIsSameHost,
            }}
            newDatabaseInputRef={newDbInputRef}
            handlers={{
              onConnectionChange: handleTargetConnectionChange,
              onDatabaseChange: setTargetDatabaseValue,
              onNewDatabaseNameChange: setNewDatabaseName,
            }}
          />

          <Section title={objectsSectionTitle(selectedCount)} testId="copy-objects-section">
            <CopyObjectsBody
              loadingObjects={loadingObjects}
              loadError={loadError}
              tree={{
                objects: objects,
                selected: selected,
                expandedCategories: expandedCategories,
                onToggleExpanded: toggleCategoryExpanded,
                onToggleCategory: toggleCategory,
                onToggleObject: toggleObject,
              }}
            />
          </Section>

          <CopyOptionsSection options={copyOptions} onOptionChange={updateCopyOption} />
        </div>

        {/* Progress — pinned above the footer so it stays visible while copying. */}
        {progress && <CopyProgressPanel progress={progress} />}

        <CopyFooterActions
          showProgress={showProgress}
          isTerminal={isTerminal}
          isCancelling={isCancelInFlight(cancelPending, progress)}
          canCopy={canCopy}
          handlers={{ onClose: onClose, onCancel: handleCancel, onCopy: handleCopy }}
        />

        {/* Footer hint */}
        <div className={styles.footer}>
          <Info size={18} weight="fill" className={styles.footerIcon} />
          <p className={styles.footerText}>
            Foreign-key checks are disabled on the target during the copy and restored afterward.
          </p>
        </div>
      </div>
    </DialogShell>
  )
}
