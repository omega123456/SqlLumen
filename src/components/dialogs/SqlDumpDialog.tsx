import { useCallback, useMemo, useState } from 'react'
import { DialogShell } from './DialogShell'
import { InfoBar } from '../common/InfoBar'
import type { DumpOptions } from '../../lib/sql-dump-commands'
import { DIALOG_EDGE_TO_EDGE_ROOT, DIALOG_JOB_BODY } from '../../lib/class-names-dialog'
import { isPlaywrightBuild } from '../../lib/tauri-env'
import { isCancelInFlight } from '../../lib/job-progress'
import { useBrowseFilePath } from '../../hooks/useBrowseFilePath'
import { selectedObjectCount } from './sql-dump-selection'
import {
  DumpActions,
  DumpDestinationField,
  DumpDialogHeader,
  DumpFooterMessage,
  DumpErrorMessage,
  DumpOptionsGroup,
  DumpProgressPanel,
  ObjectsToExportField,
} from './sql-dump-dialog/DumpDialogSections'
import { useDumpObjects } from './sql-dump-dialog/use-dump-objects'
import { useDumpJob } from './sql-dump-dialog/use-dump-job'

const DUMP_DIALOG_MAX_WIDTH = 520

function dumpDefaultFileName(initialDatabase: string | undefined, timestamp: number): string {
  if (initialDatabase) return `${initialDatabase}_dump_${timestamp}.sql`
  return `sql_dump_${timestamp}.sql`
}

function initialDumpOptions(schemaOnly: boolean): DumpOptions {
  return {
    includeStructure: true,
    includeData: !schemaOnly,
    includeDrop: true,
    useTransaction: true,
  }
}

export interface SqlDumpDialogProps {
  connectionId: string
  initialDatabase?: string
  initialTable?: string
  schemaOnly?: boolean
  onClose: () => void
}

function useDumpOptions(schemaOnly: boolean) {
  const [options, setOptions] = useState<DumpOptions>(() => initialDumpOptions(schemaOnly))
  const changeOption = useCallback((option: keyof DumpOptions, checked: boolean) => {
    setOptions((previous) => ({ ...previous, [option]: checked }))
  }, [])
  return { options: options, changeOption: changeOption }
}

function useDumpDestination(initialDatabase: string | undefined) {
  const { filePath, setFilePath, browseForFilePath } = useBrowseFilePath('sql-dump-dialog')
  const browse = useCallback(() => {
    const defaultName = dumpDefaultFileName(initialDatabase, Date.now())
    return browseForFilePath({
      defaultPath: defaultName,
      filterName: 'SQL files',
      extension: 'sql',
    })
  }, [browseForFilePath, initialDatabase])
  return { filePath: filePath, setFilePath: setFilePath, browse: browse }
}

function useSqlDumpDialog({
  connectionId,
  initialDatabase,
  initialTable,
  schemaOnly = false,
  onClose,
}: SqlDumpDialogProps) {
  const { options, changeOption } = useDumpOptions(schemaOnly)
  const destination = useDumpDestination(initialDatabase)
  const objects = useDumpObjects({
    connectionId: connectionId,
    initialDatabase: initialDatabase,
    initialTable: initialTable,
  })
  const job = useDumpJob({
    connectionId: connectionId,
    filePath: destination.filePath,
    onClose: onClose,
  })
  const { selectedTables, databases } = objects
  const selectedCount = useMemo(() => selectedObjectCount(selectedTables), [selectedTables])
  const hasSelection = selectedCount > 0

  const handleExport = () => {
    if (!destination.filePath) return
    if (!hasSelection) return
    void job.startExport({ options: options, selectedTables: selectedTables, databases: databases })
  }

  return {
    options: options,
    changeOption: changeOption,
    destination: destination,
    objects: objects,
    job: job,
    selectedCount: selectedCount,
    canExport: Boolean(destination.filePath) && hasSelection && !job.isExporting,
    handleExport: handleExport,
  }
}

export default function SqlDumpDialog(props: SqlDumpDialogProps) {
  const { schemaOnly = false, onClose } = props
  const dump = useSqlDumpDialog(props)
  const { job, objects, destination } = dump

  return (
    <DialogShell
      isOpen={true}
      onClose={onClose}
      maxWidth={DUMP_DIALOG_MAX_WIDTH}
      testId="sql-dump-dialog"
      ariaLabel="Export SQL dump"
      disableFocusManagement={isPlaywrightBuild()}
      nonDismissible={job.isExporting}
    >
      <div className={DIALOG_EDGE_TO_EDGE_ROOT}>
        <DumpDialogHeader schemaOnly={schemaOnly} isExporting={job.isExporting} onClose={onClose} />
        <div className={DIALOG_JOB_BODY}>
          <DumpOptionsGroup options={dump.options} onChange={dump.changeOption} />
          <ObjectsToExportField
            selectedCount={dump.selectedCount}
            listProps={{
              loadingObjects: objects.loadingObjects,
              loadError: objects.loadError,
              databases: objects.databases,
              selectedTables: objects.selectedTables,
              onToggleDatabase: objects.toggleDatabase,
              onToggleTable: objects.toggleTable,
            }}
          />
          <DumpDestinationField
            filePath={destination.filePath}
            onFilePathChange={destination.setFilePath}
            onBrowse={destination.browse}
          />
          {job.isExporting && job.progress && <DumpProgressPanel progress={job.progress} />}
          <DumpErrorMessage error={job.error} />
          <InfoBar
            severity="info"
            message={<DumpFooterMessage schemaOnly={schemaOnly} />}
            data-testid="dump-footer-text"
          />
          <DumpActions
            isExporting={job.isExporting}
            isCancelling={isCancelInFlight(job.cancelPending, job.progress)}
            canExport={dump.canExport}
            onCancelExport={job.cancelExport}
            onExport={dump.handleExport}
            onClose={onClose}
          />
        </div>
      </div>
    </DialogShell>
  )
}
