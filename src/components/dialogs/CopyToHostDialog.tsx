import { useCallback, useState } from 'react'
import { Info } from '@phosphor-icons/react'
import { Button } from '../common/Button'
import { TextInput } from '../common/TextInput'
import { DialogShell } from './DialogShell'
import styles from './CopyToHostDialog.module.css'
import { isCancelInFlight, isTerminalJobStatus } from '../../lib/job-progress'
import {
  DEFAULT_COPY_OPTIONS,
  EMPTY_TARGET_SELECTION,
  canStartCopy,
  draftKeyFor,
  objectsSectionTitle,
  skipFocusManagement,
  type CopyDialogOptions,
  type CopyToHostDialogProps,
} from './copy-to-host-dialog/copy-to-host-model'
import { CopyObjectsBody } from './copy-to-host-dialog/CopyObjectsSection'
import { CopyOptionsSection } from './copy-to-host-dialog/CopyOptionsSection'
import { CopyFooterActions, CopyProgressPanel } from './copy-to-host-dialog/CopyProgressPanel'
import { Section } from './copy-to-host-dialog/CopySection'
import { CopyTargetSection } from './copy-to-host-dialog/CopyTargetSection'
import { useCopyObjects } from './copy-to-host-dialog/use-copy-objects'
import { useCopyRun } from './copy-to-host-dialog/use-copy-run'
import { useCopyTarget } from './copy-to-host-dialog/use-copy-target'

export type { CopyToHostDialogProps } from './copy-to-host-dialog/copy-to-host-model'

export default function CopyToHostDialog(props: CopyToHostDialogProps) {
  return <CopyToHostDialogBody key={draftKeyFor(props)} {...props} />
}

function CopyDialogHeader({ isCopying, onClose }: { isCopying: boolean; onClose: () => void }) {
  return (
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
  )
}

interface CopySourceSectionProps {
  connectionLabel: string
  database: string
}

function CopySourceSection({ connectionLabel, database }: CopySourceSectionProps) {
  return (
    <Section title="Source" testId="copy-source-section">
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} htmlFor="copy-source-connection">
          Connection
        </label>
        <TextInput
          id="copy-source-connection"
          value={connectionLabel}
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
          value={database}
          disabled
          readOnly
          data-testid="copy-source-database"
        />
      </div>
    </Section>
  )
}

function CopyFooterHint() {
  return (
    <div className={styles.footer}>
      <Info size={18} weight="fill" className={styles.footerIcon} />
      <p className={styles.footerText}>
        Foreign-key checks are disabled on the target during the copy and restored afterward.
      </p>
    </div>
  )
}

function useCopyOptions() {
  const [copyOptions, setCopyOptions] = useState<CopyDialogOptions>(DEFAULT_COPY_OPTIONS)
  const updateCopyOption = useCallback(
    <Key extends keyof CopyDialogOptions>(key: Key, value: CopyDialogOptions[Key]) => {
      setCopyOptions((previous) => ({ ...previous, [key]: value }))
    },
    []
  )
  return { copyOptions, updateCopyOption }
}

type CopyTarget = ReturnType<typeof useCopyTarget>
type CopyObjects = ReturnType<typeof useCopyObjects>

interface CopyDialogSectionsProps {
  props: CopyToHostDialogProps
  target: Omit<CopyTarget, 'newDatabaseInputRef'>
  newDatabaseInputRef: CopyTarget['newDatabaseInputRef']
  sourceObjects: CopyObjects
  options: ReturnType<typeof useCopyOptions>
}

function CopyDialogSections(sections: CopyDialogSectionsProps) {
  const { props, target, newDatabaseInputRef, sourceObjects, options } = sections
  const { targetSelection, setTargetSelection } = target
  return (
    <div className={styles.body}>
      <CopySourceSection
        connectionLabel={props.sourceConnectionLabel}
        database={props.sourceDatabase}
      />
      <CopyTargetSection
        target={{
          connectionOptions: target.connectionOptions,
          connectionId: targetSelection.connectionId,
          databaseOptions: target.databaseOptions,
          databaseValue: targetSelection.databaseValue,
          newDatabaseName: targetSelection.newDatabaseName,
          notice: target.notice,
          isSameHost: target.isSameHost,
        }}
        newDatabaseInputRef={newDatabaseInputRef}
        handlers={{
          onConnectionChange: (connectionId) =>
            setTargetSelection({ ...EMPTY_TARGET_SELECTION, connectionId: connectionId }),
          onDatabaseChange: (databaseValue) =>
            setTargetSelection((previous) => ({ ...previous, databaseValue: databaseValue })),
          onNewDatabaseNameChange: (newName) =>
            setTargetSelection((previous) => ({ ...previous, newDatabaseName: newName })),
        }}
      />
      <Section
        title={objectsSectionTitle(sourceObjects.selectedCount)}
        testId="copy-objects-section"
      >
        <CopyObjectsBody
          loadingObjects={sourceObjects.loadingObjects}
          loadError={sourceObjects.loadError}
          tree={{
            objects: sourceObjects.objects,
            selected: sourceObjects.selected,
            expandedCategories: sourceObjects.expandedCategories,
            onToggleExpanded: sourceObjects.toggleCategoryExpanded,
            onToggleCategory: sourceObjects.toggleCategory,
            onToggleObject: sourceObjects.toggleObject,
          }}
        />
      </Section>
      <CopyOptionsSection options={options.copyOptions} onOptionChange={options.updateCopyOption} />
    </div>
  )
}

function useCopyToHostDialog(props: CopyToHostDialogProps) {
  const { sourceConnectionId, sourceDatabase } = props
  const sourceObjects = useCopyObjects(props)
  const { newDatabaseInputRef, ...target } = useCopyTarget({ sourceConnectionId, sourceDatabase })
  const options = useCopyOptions()
  const { copyRun, startCopy, handleCancel } = useCopyRun()
  const targetConnectionId = target.targetSelection.connectionId
  const canCopy = canStartCopy({
    targetConnectionId: targetConnectionId,
    targetDatabase: target.effectiveTargetDatabase,
    selectedCount: sourceObjects.selectedCount,
    isCopying: copyRun.isCopying,
  })
  const handleCopy = () =>
    startCopy({
      canCopy: canCopy,
      selected: sourceObjects.selected,
      copyOptions: options.copyOptions,
      sourceConnectionId: sourceConnectionId,
      sourceDatabase: sourceDatabase,
      targetConnectionId: targetConnectionId,
      targetDatabase: target.effectiveTargetDatabase,
    })
  return {
    sourceObjects,
    newDatabaseInputRef,
    target,
    options,
    copyRun,
    canCopy,
    handleCopy,
    handleCancel,
  }
}

function CopyToHostDialogBody(props: CopyToHostDialogProps) {
  const { isOpen, onClose } = props
  const { newDatabaseInputRef, sourceObjects, target, options, copyRun, canCopy, ...actions } =
    useCopyToHostDialog(props)
  const { isCopying, progress, cancelPending } = copyRun
  const isTerminal = isTerminalJobStatus(progress?.status)

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
        <CopyDialogHeader isCopying={isCopying} onClose={onClose} />
        <CopyDialogSections
          props={props}
          target={target}
          newDatabaseInputRef={newDatabaseInputRef}
          sourceObjects={sourceObjects}
          options={options}
        />
        {progress && <CopyProgressPanel progress={progress} />}
        <CopyFooterActions
          showProgress={isCopying || progress !== null}
          isTerminal={isTerminal}
          isCancelling={isCancelInFlight(cancelPending, progress)}
          canCopy={canCopy}
          handlers={{
            onClose: onClose,
            onCancel: actions.handleCancel,
            onCopy: actions.handleCopy,
          }}
        />
        <CopyFooterHint />
      </div>
    </DialogShell>
  )
}
