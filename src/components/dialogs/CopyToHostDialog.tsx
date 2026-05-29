import { useState, useCallback, useEffect, useRef, useMemo, type ReactNode } from 'react'
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
import { logFrontend } from '../../lib/app-log-commands'
import styles from './CopyToHostDialog.module.css'

// Skip focus management in deterministic test environments (Playwright + Vitest/jsdom) so the
// focus trap's rAF-driven focus restoration cannot interfere with portalled dropdown interactions.
const skipFocusManagement =
  import.meta.env.VITE_PLAYWRIGHT === 'true' || import.meta.env.VITEST === true

/** Polling interval for progress updates (ms). */
const PROGRESS_POLL_MS = 500

/** Sentinel value used by the target database dropdown to mean "create a new database". */
const NEW_DB_SENTINEL = '__new__'

/** Copy type controls which of structure / data are transferred. */
type CopyType = 'both' | 'structureOnly' | 'dataOnly'

const CATEGORY_LABELS = COPY_OBJECT_CATEGORY_LABELS
const CATEGORY_ORDER = COPY_OBJECT_CATEGORY_ORDER

const COPY_TYPE_OPTIONS: DropdownOption[] = [
  { value: 'both', label: 'Structure + Data' },
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
    return objects.tables.map((t) => t.name)
  }
  return objects[category]
}

function isTerminalProgress(progress: CopyProgress | null): boolean {
  return (
    progress?.status === 'completed' ||
    progress?.status === 'failed' ||
    progress?.status === 'cancelled'
  )
}

function progressPercent(done: number | null | undefined, total: number | null | undefined): number {
  if (!total) return 0
  return Math.round(((done ?? 0) / total) * 100)
}

export default function CopyToHostDialog({
  isOpen,
  onClose,
  sourceConnectionId,
  sourceConnectionLabel,
  sourceDatabase,
  preSelectedObject,
}: CopyToHostDialogProps) {
  const savedConnections = useConnectionStore((s) => s.savedConnections)
  const activeConnections = useConnectionStore((s) => s.activeConnections)

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
  const [expandedCategories, setExpandedCategories] = useState<Set<CopyObjectCategory>>(
    () => new Set(preSelectedObject ? [preSelectedObject.category] : [])
  )

  // Options
  const [copyType, setCopyType] = useState<CopyType>('both')
  const [dropIfExists, setDropIfExists] = useState(true)
  const [createIfNotExists, setCreateIfNotExists] = useState(true)
  const [insertMode, setInsertMode] = useState<CopyInsertMode>('insert')
  const [truncateBeforeInsert, setTruncateBeforeInsert] = useState(false)
  const [ignoreDefiner, setIgnoreDefiner] = useState(true)

  // Copy run state
  const [isCopying, setIsCopying] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<CopyProgress | null>(null)
  const [cancelPending, setCancelPending] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const newDbInputRef = useRef<HTMLInputElement>(null)

  // Capture the pre-selected object's primitive fields so the load effect depends on stable values
  // (not a fresh object reference on every render).
  const preSelectedCategory = preSelectedObject?.category ?? null
  const preSelectedName = preSelectedObject?.name ?? null

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
    setExpandedCategories(
      new Set(preSelectedCategory ? [preSelectedCategory] : [])
    )
    setCopyType('both')
    setDropIfExists(true)
    setCreateIfNotExists(true)
    setInsertMode('insert')
    setTruncateBeforeInsert(false)
    setIgnoreDefiner(true)
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
        setExpandedCategories((prev) => {
          const next = new Set(prev)
          for (const category of CATEGORY_ORDER) {
            if (categoryNames(result, category).length > 0) next.add(category)
          }
          return next
        })
        if (preSelectedCategory && preSelectedName) {
          const names = categoryNames(result, preSelectedCategory)
          if (names.includes(preSelectedName)) {
            setSelected((prev) => {
              const next = { ...prev }
              next[preSelectedCategory] = new Set([preSelectedName])
              return next
            })
          }
        }
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        setLoadError(msg)
        logFrontend(
          'error',
          ['[copy-to-host] Failed to load copyable objects:', msg].map(String).join(' ')
        )
        showErrorToast('Failed to load copyable objects', msg)
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
          setTargetDatabaseValue((prev) => (prev === '' ? sourceDatabase : prev))
        }
      } catch (err) {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        setTargetDatabases([])
        setTargetDatabaseNotice(null)
        logFrontend(
          'error',
          ['[copy-to-host] Failed to load target databases:', msg].map(String).join(' ')
        )
        showErrorToast(`Failed to load target databases: ${msg}`)
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

  // Poll for progress while a job is running.
  useEffect(() => {
    if (!jobId) return

    const stopPolling = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }

    const poll = () => {
      getCopyProgress(jobId)
        .then((p) => {
          setProgress(p)
          if (p.status === 'completed') {
            setIsCopying(false)
            stopPolling()
            showSuccessToast(
              'Copy completed',
              `${p.objectsDone} ${p.objectsDone === 1 ? 'object' : 'objects'} copied`
            )
          } else if (p.status === 'cancelled') {
            setIsCopying(false)
            setCancelPending(false)
            stopPolling()
          } else if (p.status === 'failed') {
            setIsCopying(false)
            stopPolling()
            showErrorToast('Copy failed', p.errorMessage ?? 'Copy to host failed')
          }
        })
        .catch((err) => {
          logFrontend(
            'error',
            ['[copy-to-host] Failed to poll progress:', err].map(String).join(' ')
          )
        })
    }

    pollRef.current = setInterval(poll, PROGRESS_POLL_MS)
    poll()

    return () => {
      stopPolling()
    }
  }, [jobId])

  // Target connection options exclude the source host and any read-only connection.
  const targetConnectionOptions = useMemo<DropdownOption[]>(() => {
    const opts = savedConnections
      .filter((c) => !c.readOnly)
      .filter((c) => sourceHost === null || normalizeHost(c.host) !== sourceHost)
      .map((c) => ({
        value: c.id,
        label: c.name,
        description: `${c.host}:${c.port}`,
      }))
    return [{ value: '', label: 'Select a connection…' }, ...opts]
  }, [savedConnections, sourceHost])

  // Database dropdown options: existing databases + the "+ New database…" sentinel.
  const targetDatabaseOptions = useMemo<DropdownOption[]>(() => {
    const opts: DropdownOption[] = [{ value: '', label: 'Select a database…' }]
    for (const db of targetDatabases) {
      opts.push({ value: db, label: db })
    }
    opts.push({
      value: NEW_DB_SENTINEL,
      label: '+ New database…',
      description: 'Create a new database on the target',
    })
    return opts
  }, [targetDatabases])

  // The same-host guard: warn if the chosen target resolves to the source host.
  const targetIsSameHost = useMemo(() => {
    if (!targetConnectionId || sourceHost === null) return false
    const target = savedConnections.find((c) => c.id === targetConnectionId)
    return normalizeHost(target?.host) === sourceHost
  }, [savedConnections, targetConnectionId, sourceHost])

  // The effective target database name (existing selection or the typed new name).
  const effectiveTargetDatabase = useMemo(() => {
    if (targetDatabaseValue === NEW_DB_SENTINEL) return newDatabaseName.trim()
    return targetDatabaseValue
  }, [targetDatabaseValue, newDatabaseName])

  const selectedCount = useMemo(() => countCopySelection(selected), [selected])

  const canCopy =
    !!targetConnectionId && !!effectiveTargetDatabase && selectedCount > 0 && !isCopying

  const structureDisabled = copyType === 'dataOnly'
  const dataDisabled = copyType === 'structureOnly'

  // Toggle a single object within a category.
  const toggleObject = useCallback((category: CopyObjectCategory, name: string) => {
    setSelected((prev) => {
      const next = { ...prev }
      const set = new Set(prev[category])
      if (set.has(name)) {
        set.delete(name)
      } else {
        set.add(name)
      }
      next[category] = set
      return next
    })
  }, [])

  // Toggle all objects within a category (select-all checkbox).
  const toggleCategory = useCallback(
    (category: CopyObjectCategory) => {
      if (!objects) return
      const names = categoryNames(objects, category)
      setSelected((prev) => {
        const next = { ...prev }
        next[category] = prev[category].size === names.length ? new Set() : new Set(names)
        return next
      })
    },
    [objects]
  )

  const toggleCategoryExpanded = useCallback((category: CopyObjectCategory) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }, [])

  // Start the copy job.
  const handleCopy = useCallback(async () => {
    if (!canCopy) return
    setIsCopying(true)
    setProgress(null)

    const copyObjects = assembleCopyObjects(selected)

    const options: CopyToHostOptions = {
      copyStructure: copyType !== 'dataOnly',
      copyData: copyType !== 'structureOnly',
      dropIfExists,
      createIfNotExists,
      truncateBeforeInsert,
      insertMode,
      ignoreDefiner,
    }

    try {
      const id = await startCopyToHost({
        sourceConnectionId,
        sourceDatabase,
        targetConnectionId,
        targetDatabase: effectiveTargetDatabase,
        objects: copyObjects,
        options,
      })
      setJobId(id)
    } catch (err) {
      setIsCopying(false)
      const msg = err instanceof Error ? err.message : String(err)
      showErrorToast('Copy failed', msg)
      logFrontend('error', ['[copy-to-host] Failed to start copy:', msg].map(String).join(' '))
    }
  }, [
    canCopy,
    selected,
    copyType,
    dropIfExists,
    createIfNotExists,
    truncateBeforeInsert,
    insertMode,
    ignoreDefiner,
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
    } catch (err) {
      setCancelPending(false)
      const msg = err instanceof Error ? err.message : String(err)
      logFrontend('error', ['[copy-to-host] Failed to cancel copy:', msg].map(String).join(' '))
      showErrorToast('Failed to cancel copy', msg)
    }
  }, [jobId, cancelPending])

  const isTerminal = isTerminalProgress(progress)

  const objectsPercent = useMemo(() => {
    return progressPercent(progress?.objectsDone, progress?.objectsTotal)
  }, [progress])

  const rowsPercent = useMemo(() => {
    return progressPercent(progress?.rowsDone, progress?.rowsTotal)
  }, [progress])

  // Show the row-level micro bar only for an in-progress table with a known total.
  const showRowBar =
    !!progress &&
    progress.status === 'running' &&
    progress.currentObjectType === 'table' &&
    !!progress.rowsTotal

  const showTypeBadge =
    !!progress &&
    progress.status === 'running' &&
    !!progress.currentObject &&
    !showRowBar &&
    !!progress.currentObjectType

  const showProgress = isCopying || !!progress

  return (
    <DialogShell
      isOpen={isOpen}
      onClose={onClose}
      panelWidth="min(72vw, 1240px)"
      panelHeight="min(92vh, max(70vh, 820px))"
      panelPadding={false}
      testId="copy-to-host-dialog"
      ariaLabel="Copy to Another Host"
      disableFocusManagement={skipFocusManagement}
      nonDismissible={isCopying}
    >
      <div className={styles.root}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>Copy to Another Host</h2>
          {!isCopying && (
            <Button
              variant="ghost"
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

          {/* Target */}
          <Section title="Target" testId="copy-target-section">
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} id="copy-target-connection-label">
                Connection
              </label>
              <Dropdown
                id="copy-target-connection"
                labelledBy="copy-target-connection-label"
                options={targetConnectionOptions}
                value={targetConnectionId}
                onChange={(v) => {
                  setTargetConnectionId(v)
                  setTargetDatabaseValue('')
                  setNewDatabaseName('')
                }}
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
                options={targetDatabaseOptions}
                value={targetDatabaseValue}
                disabled={!targetConnectionId}
                onChange={setTargetDatabaseValue}
                data-testid="copy-target-database"
              />
              {targetDatabaseValue === NEW_DB_SENTINEL && (
                <div className={styles.newDbGroup}>
                  <TextInput
                    ref={newDbInputRef}
                    value={newDatabaseName}
                    onChange={(e) => setNewDatabaseName(e.target.value)}
                    placeholder="new_database_name"
                    aria-label="New database name"
                    data-testid="copy-new-database-name"
                  />
                </div>
              )}
              {targetDatabaseNotice && (
                <p className={styles.infoNote} data-testid="copy-target-database-notice">
                  <Info size={14} weight="fill" className={styles.infoIcon} />
                  {targetDatabaseNotice}
                </p>
              )}
            </div>
            {targetIsSameHost && (
              <p className={styles.warningNote} data-testid="copy-same-host-warning">
                <Warning size={14} weight="fill" className={styles.warningIcon} />
                The target resolves to the same host as the source. Choose a different host.
              </p>
            )}
          </Section>

          {/* Objects */}
          <Section
            title={`Objects${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
            testId="copy-objects-section"
          >
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
                {CATEGORY_ORDER.map((category) => {
                  const names = categoryNames(objects, category)
                  const selectedSet = selected[category]
                  const allSelected = names.length > 0 && selectedSet.size === names.length
                  const someSelected = selectedSet.size > 0 && !allSelected
                  const isEmpty = names.length === 0
                  const isExpanded = expandedCategories.has(category)

                  return (
                    <div key={category} className={styles.objectCategory}>
                      <div className={styles.objectCategoryHeader}>
                        <Button
                          variant="ghost"
                          className={styles.caretButton}
                          onClick={() => toggleCategoryExpanded(category)}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${CATEGORY_LABELS[category]}`}
                          data-testid={`copy-category-toggle-${category}`}
                        >
                          <svg
                            className={`${styles.caret} ${isExpanded ? styles.caretOpen : ''}`}
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
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected
                          }}
                          onChange={() => toggleCategory(category)}
                          aria-label={`Select all ${CATEGORY_LABELS[category]}`}
                          data-testid={`copy-category-${category}`}
                        />
                        <span className={styles.objectCategoryLabel}>
                          {CATEGORY_LABELS[category]}
                        </span>
                        <span className={styles.objectCategoryCount}>({names.length})</span>
                      </div>
                      {isExpanded && !isEmpty && (
                        <div className={styles.objectItems}>
                          {names.map((name) => (
                            <div key={name} className={styles.objectItem}>
                              <Checkbox
                                checked={selectedSet.has(name)}
                                onChange={() => toggleObject(category, name)}
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
                })}
              </div>
            )}
          </Section>

          {/* Options */}
          <Section title="Options" testId="copy-options-section">
            <div className={styles.fieldGroup}>
              <label className={styles.fieldLabel} id="copy-type-label">
                Copy type
              </label>
              <Dropdown
                id="copy-type"
                labelledBy="copy-type-label"
                options={COPY_TYPE_OPTIONS}
                value={copyType}
                onChange={(v) => setCopyType(v as CopyType)}
                data-testid="copy-type"
              />
            </div>

            {/* Structure group */}
            <div
              className={`${styles.optionGroup} ${structureDisabled ? styles.dimmed : ''}`}
              aria-disabled={structureDisabled}
              data-testid="copy-structure-group"
            >
              <span className={styles.optionGroupLabel}>Structure</span>
              <div className={`${styles.checkboxRow} ${styles.warningAccent}`}>
                <Warning size={14} weight="fill" className={styles.warningIcon} />
                <Checkbox
                  id="copy-drop-if-exists"
                  checked={dropIfExists}
                  disabled={structureDisabled}
                  onChange={(e) => setDropIfExists(e.target.checked)}
                  data-testid="copy-drop-if-exists"
                />
                <label htmlFor="copy-drop-if-exists" className={styles.checkboxLabel}>
                  DROP … IF EXISTS first
                </label>
              </div>
              <div className={styles.checkboxRow}>
                <Checkbox
                  id="copy-create-if-not-exists"
                  checked={createIfNotExists}
                  disabled={structureDisabled}
                  onChange={(e) => setCreateIfNotExists(e.target.checked)}
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

            {/* Data group */}
            <div
              className={`${styles.optionGroup} ${dataDisabled ? styles.dimmed : ''}`}
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
                  value={insertMode}
                  disabled={dataDisabled}
                  onChange={(v) => setInsertMode(v as CopyInsertMode)}
                  data-testid="copy-insert-mode"
                />
              </div>
              <div className={`${styles.checkboxRow} ${styles.warningAccent}`}>
                <Warning size={14} weight="fill" className={styles.warningIcon} />
                <Checkbox
                  id="copy-truncate"
                  checked={truncateBeforeInsert}
                  disabled={dataDisabled}
                  onChange={(e) => setTruncateBeforeInsert(e.target.checked)}
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
                checked={ignoreDefiner}
                onChange={(e) => setIgnoreDefiner(e.target.checked)}
                data-testid="copy-ignore-definer"
              />
              <label htmlFor="copy-ignore-definer" className={styles.checkboxLabel}>
                Ignore Definer (strip DEFINER from routines/triggers/events)
              </label>
            </div>
          </Section>
        </div>

        {/* Progress — pinned above the footer so it stays visible while copying. */}
        {showProgress && progress && (
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
                {showRowBar ? (
                  <span className={styles.progressCount} data-testid="copy-row-count">
                    {(progress.rowsDone ?? 0).toLocaleString()} /{' '}
                    {(progress.rowsTotal ?? 0).toLocaleString()}
                  </span>
                ) : showTypeBadge ? (
                  <span className={styles.typeBadge} data-testid="copy-type-badge">
                    {progress.currentObjectType}
                  </span>
                ) : null}
              </div>
            )}

            {showRowBar && (
              <div className={styles.microBar}>
                <div className={styles.microFill} style={{ width: `${rowsPercent}%` }} />
              </div>
            )}

            {progress.status === 'completed' && (
              <p className={styles.statusSuccess} data-testid="copy-status-success">
                Completed — {progress.objectsDone}{' '}
                {progress.objectsDone === 1 ? 'object' : 'objects'} copied
              </p>
            )}
            {progress.status === 'cancelled' && (
              <p className={styles.statusCancel} data-testid="copy-status-cancel">
                Cancelled — {progress.objectsDone} of {progress.objectsTotal} objects copied
              </p>
            )}
            {progress.status === 'failed' && (
              <div className={styles.statusError} data-testid="copy-status-error">
                Failed
                {progress.currentObject ? ` on ${progress.currentObject}` : ''}:
                <br />
                {progress.errorMessage ?? 'Unknown error'}
              </div>
            )}
          </div>
        )}

        {/* Footer actions */}
        <div className={styles.footerActions}>
          {showProgress ? (
            <Button
              variant={isTerminal ? 'secondary' : 'danger'}
              onClick={isTerminal ? onClose : handleCancel}
              disabled={!isTerminal && (cancelPending || progress?.cancelRequested)}
              data-testid="copy-progress-action"
            >
              {isTerminal
                ? 'Close'
                : cancelPending || progress?.cancelRequested
                  ? 'Cancelling…'
                  : 'Cancel'}
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose} data-testid="copy-cancel-button">
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleCopy}
                disabled={!canCopy}
                data-testid="copy-submit-button"
              >
                Copy
              </Button>
            </>
          )}
        </div>

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
