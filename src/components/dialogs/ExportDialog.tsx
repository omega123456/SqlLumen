import { DialogShell } from './DialogShell'
import { useQueryStore, type ExportRowScope } from '../../stores/query-store'
import type { ExportFormat } from '../../types/schema'
import type { DropdownOption } from '../common/Dropdown'
import { DIALOG_EDGE_TO_EDGE_ROOT, EXPORT_DIALOG_BODY } from '../../lib/class-names-dialog'
import { isPlaywrightBuild } from '../../lib/tauri-env'
import { useFormSubmit } from '../../hooks/useFormSubmit'
import type { ViewModifiers } from './export-dialog/export-format'
import {
  DestinationField,
  ExportDialogHeader,
  ExportError,
  ExportFormActions,
  FormatField,
  FullExportOutcome,
  FullExportProgress,
  IgnoredViewWarning,
  IncludeHeadersField,
  RowScopeField,
  SheetLimitWarning,
  TableNameField,
} from './export-dialog/ExportFields'
import { useExportActions, type ExportDialogProps } from './export-dialog/use-export-actions'
import { useExportDialogState } from './export-dialog/use-export-dialog-state'

type ExportActions = ReturnType<typeof useExportActions>

interface ExportScopeChoice {
  offersAllRows: boolean
  rowScopeOptions: DropdownOption<ExportRowScope>[]
  effectiveScope: ExportRowScope
  isAllRows: boolean
  viewModifiers: ViewModifiers
  setScope: (scope: ExportRowScope) => void
}

interface ExportFormatChoice {
  format: ExportFormat
  formatDropdownOptions: DropdownOption<ExportFormat>[]
  setFormat: (format: ExportFormat) => void
}

interface ExportFormBodyProps {
  scope: ExportScopeChoice
  formatChoice: ExportFormatChoice
  actions: ExportActions
  outcome: Pick<Parameters<typeof FullExportOutcome>[0], 'exportJob' | 'failureBarRef'>
  onClose: () => void
}

function ExportFormBody({ scope, formatChoice, actions, outcome, onClose }: ExportFormBodyProps) {
  const { format, setFormat } = formatChoice
  return (
    <div className={EXPORT_DIALOG_BODY}>
      <RowScopeField
        offersAllRows={scope.offersAllRows}
        options={scope.rowScopeOptions}
        value={scope.effectiveScope}
        onChange={scope.setScope}
      />
      <IgnoredViewWarning
        isAllRows={scope.isAllRows}
        modifiers={scope.viewModifiers}
        onUseCurrentView={() => scope.setScope('currentView')}
      />

      <FormatField
        options={formatChoice.formatDropdownOptions}
        format={format}
        onChange={setFormat}
      />
      <SheetLimitWarning
        isAllRows={scope.isAllRows}
        format={format}
        onSwitchToCsv={() => setFormat('csv')}
      />

      <DestinationField
        format={format}
        filePath={actions.filePath}
        onChange={actions.setFilePath}
        onBrowse={actions.handleBrowse}
      />

      <TableNameField
        format={format}
        tableName={actions.tableName}
        onChange={actions.setTableName}
      />

      <IncludeHeadersField checked={actions.includeHeaders} onChange={actions.setIncludeHeaders} />
      <ExportError error={actions.error} />

      <FullExportOutcome
        exportJob={outcome.exportJob}
        failureBarRef={outcome.failureBarRef}
        onRetry={actions.handleRetryFullExport}
      />

      <ExportFormActions
        canSubmit={Boolean(actions.filePath) && !actions.isExporting}
        isExporting={actions.isExporting}
        onClose={onClose}
      />
    </div>
  )
}

export default function ExportDialog(props: ExportDialogProps) {
  const { tabId, onClose } = props
  const { failureBarRef, exportJob, runningJob, ...state } = useExportDialogState({
    tabId: tabId,
    resultIndex: props.resultIndex,
    hasCustomExport: props.onExport !== undefined,
    isView: props.isView,
  })
  const actions = useExportActions({
    props: props,
    format: state.format,
    isAllRows: state.isAllRows,
    resolvedResultIndex: state.resolvedResultIndex,
  })
  const cancelFullExport = useQueryStore((store) => store.cancelFullExport)
  const handleSubmit = useFormSubmit(actions.handleExport)
  const isFullExportRunning = runningJob !== null

  return (
    <DialogShell
      isOpen={true}
      onClose={onClose}
      maxWidth={440}
      testId="export-dialog"
      ariaLabel="Export results"
      disableFocusManagement={isPlaywrightBuild()}
      nonDismissible={isFullExportRunning}
      formProps={{ onSubmit: handleSubmit }}
    >
      <div className={DIALOG_EDGE_TO_EDGE_ROOT}>
        <ExportDialogHeader canClose={!isFullExportRunning} onClose={onClose} />
        {runningJob ? (
          <FullExportProgress
            exportJob={runningJob}
            onCancel={() => void cancelFullExport(tabId)}
          />
        ) : (
          <ExportFormBody
            scope={state}
            formatChoice={state}
            actions={actions}
            outcome={{ exportJob: exportJob, failureBarRef: failureBarRef }}
            onClose={onClose}
          />
        )}
      </div>
    </DialogShell>
  )
}
