import type { RefObject } from 'react'
import { FolderOpen, X } from '@phosphor-icons/react'
import { Dropdown, type DropdownOption } from '../../common/Dropdown'
import { TextInput } from '../../common/TextInput'
import { Checkbox } from '../../common/Checkbox'
import { InfoBar } from '../../common/InfoBar'
import { Button } from '../../common/Button'
import type { ExportRowScope, ResultExportJob } from '../../../stores/query-store'
import type { ExportFormat } from '../../../types/schema'
import {
  DEFAULT_EXPORT_TABLE_NAME,
  EXPORT_FORMAT_CONFIG,
  exportProgressText,
  ignoredViewMessage,
  type ViewModifiers,
} from './export-format'
import { joinClassNames } from '../../../lib/class-names'
import {
  EXPORT_DIALOG_BODY,
  DIALOG_BROWSE_BUTTON,
  DIALOG_CHECKBOX_LABEL,
  DIALOG_CLOSE_BUTTON,
  DIALOG_DESTINATION_GROUP,
  DIALOG_DESTINATION_INPUT,
  DIALOG_DESTINATION_PREFIX,
  DIALOG_FOOTER_BLEED,
  DIALOG_FOOTER_GRID,
  DIALOG_FORM_FIELD,
  DIALOG_FORM_LABEL,
  DIALOG_HEADER,
  DIALOG_HEADER_TITLE,
  DIALOG_INLINE_ERROR_BOX,
  DIALOG_PROGRESS_PANEL,
  DIALOG_PROGRESS_TRACK,
} from '../../../lib/class-names-dialog'

const HEADER_ICON_SIZE = 20

interface FullExportProgressProps {
  exportJob: ResultExportJob
  onCancel: () => void
}

export function FullExportProgress({ exportJob, onCancel }: FullExportProgressProps) {
  return (
    <div className={EXPORT_DIALOG_BODY}>
      <div className={DIALOG_PROGRESS_PANEL} data-testid="export-progress">
        <span
          className="font-body text-size-body text-light-on-surface dark:text-dark-on-surface"
          role="status"
        >
          Exporting all rows…
        </span>
        <div className={joinClassNames([DIALOG_PROGRESS_TRACK, 'relative'])} aria-hidden="true">
          <div className="absolute inset-y-0 rounded-track bg-light-primary dark:bg-dark-primary motion-reduce:left-0 motion-reduce:w-full motion-safe:-left-2/5 motion-safe:w-2/5 motion-safe:animate-indeterminate-slide motion-safe:window-blurred:animate-indeterminate-slide-paused" />
        </div>
        <span
          className="font-body text-size-caption tabular-nums text-light-on-surface-variant dark:text-dark-on-surface-variant"
          data-testid="export-progress-stats"
        >
          {exportProgressText(exportJob)}
        </span>
      </div>
      <div className={joinClassNames([DIALOG_FOOTER_BLEED, 'mt-2.5 flex justify-end gap-2'])}>
        <Button
          type="button"
          disabled={exportJob.cancelRequested}
          onClick={onCancel}
          data-testid="export-cancel-full-button"
        >
          {exportJob.cancelRequested ? 'Cancelling…' : 'Cancel export'}
        </Button>
      </div>
    </div>
  )
}

interface RowScopeFieldProps {
  offersAllRows: boolean
  options: DropdownOption<ExportRowScope>[]
  value: ExportRowScope
  onChange: (scope: ExportRowScope) => void
}

export function RowScopeField({ offersAllRows, options, value, onChange }: RowScopeFieldProps) {
  if (!offersAllRows) return null
  return (
    <div className={DIALOG_FORM_FIELD}>
      <label className={DIALOG_FORM_LABEL} id="export-rows-label">
        Rows
      </label>
      <Dropdown
        id="export-rows"
        labelledBy="export-rows-label"
        options={options}
        value={value}
        onChange={onChange}
        data-testid="export-rows-select"
        className="w-full"
        triggerChrome="dialogField"
      />
    </div>
  )
}

interface IgnoredViewWarningProps {
  isAllRows: boolean
  modifiers: ViewModifiers
  onUseCurrentView: () => void
}

export function IgnoredViewWarning({
  isAllRows,
  modifiers,
  onUseCurrentView,
}: IgnoredViewWarningProps) {
  const hasViewModifiers = modifiers.hasSort || modifiers.filterCount > 0
  if (!isAllRows) return null
  if (!hasViewModifiers) return null
  return (
    <InfoBar
      severity="warning"
      polite
      title="Sort and filter aren't applied to all rows."
      message={ignoredViewMessage(modifiers.hasSort, modifiers.filterCount)}
      actions={
        <Button
          type="button"
          size="sm"
          onClick={onUseCurrentView}
          data-testid="export-use-current-view"
        >
          Use current view
        </Button>
      }
      data-testid="export-ignored-view-warning"
    />
  )
}

interface SheetLimitWarningProps {
  isAllRows: boolean
  format: ExportFormat
  onSwitchToCsv: () => void
}

export function SheetLimitWarning({ isAllRows, format, onSwitchToCsv }: SheetLimitWarningProps) {
  if (!isAllRows) return null
  if (format !== 'xlsx') return null
  return (
    <InfoBar
      severity="warning"
      polite
      message="Excel sheets stop at 1,048,576 rows. Rows past that are not written."
      actions={
        <Button type="button" size="sm" onClick={onSwitchToCsv} data-testid="export-switch-to-csv">
          Switch to CSV
        </Button>
      }
      data-testid="export-sheet-limit-warning"
    />
  )
}

interface TableNameFieldProps {
  format: ExportFormat
  tableName: string
  onChange: (tableName: string) => void
}

export function TableNameField({ format, tableName, onChange }: TableNameFieldProps) {
  if (!EXPORT_FORMAT_CONFIG[format].requiresTableName) return null
  return (
    <div className={DIALOG_FORM_FIELD}>
      <label className={DIALOG_FORM_LABEL} htmlFor="export-table-name">
        Table name
      </label>
      <TextInput
        id="export-table-name"
        variant="bare"
        type="text"
        className="w-full rounded-control border border-light-stroke-control bg-light-fill-control px-2.5 py-1.25 font-mono text-size-mono leading-5 text-light-on-surface transition-shadow outline-none focus:border-light-primary focus:shadow-light-field-focus dark:border-dark-stroke-control dark:bg-dark-fill-control dark:text-dark-on-surface dark:focus:border-dark-primary dark:focus:shadow-dark-field-focus"
        value={tableName}
        onChange={(event) => onChange(event.target.value)}
        placeholder={DEFAULT_EXPORT_TABLE_NAME}
        data-testid="export-table-name-input"
      />
    </div>
  )
}

interface ExportDialogHeaderProps {
  canClose: boolean
  onClose: () => void
}

export function ExportDialogHeader({ canClose, onClose }: ExportDialogHeaderProps) {
  return (
    <div className={DIALOG_HEADER}>
      <h2 className={DIALOG_HEADER_TITLE}>Export results</h2>
      {canClose && (
        <Button variant="bare" className={DIALOG_CLOSE_BUTTON} onClick={onClose} aria-label="Close">
          <X size={HEADER_ICON_SIZE} aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

interface FormatFieldProps {
  options: DropdownOption<ExportFormat>[]
  format: ExportFormat
  onChange: (format: ExportFormat) => void
}

export function FormatField({ options, format, onChange }: FormatFieldProps) {
  return (
    <div className={DIALOG_FORM_FIELD}>
      <label className={DIALOG_FORM_LABEL} id="export-format-label">
        Format
      </label>
      <Dropdown
        id="export-format"
        labelledBy="export-format-label"
        options={options}
        value={format}
        onChange={onChange}
        data-testid="export-format-select"
        className="w-full"
        triggerChrome="dialogField"
      />
    </div>
  )
}

interface DestinationFieldProps {
  format: ExportFormat
  filePath: string
  onChange: (filePath: string) => void
  onBrowse: () => void
}

export function DestinationField({ format, filePath, onChange, onBrowse }: DestinationFieldProps) {
  const extension = EXPORT_FORMAT_CONFIG[format].extension
  return (
    <div className={DIALOG_FORM_FIELD}>
      <label className={DIALOG_FORM_LABEL} htmlFor="export-file-path">
        Destination
      </label>
      <div className={DIALOG_DESTINATION_GROUP}>
        <span className={DIALOG_DESTINATION_PREFIX}>.{extension}</span>
        <TextInput
          id="export-file-path"
          variant="bare"
          type="text"
          className={DIALOG_DESTINATION_INPUT}
          value={filePath}
          onChange={(event) => onChange(event.target.value)}
          placeholder={`query_results.${extension}`}
          data-testid="export-file-path-input"
        />
        <Button
          variant="bare"
          className={DIALOG_BROWSE_BUTTON}
          onClick={onBrowse}
          aria-label="Browse"
          data-testid="export-browse-button"
        >
          <FolderOpen size={HEADER_ICON_SIZE} aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

interface IncludeHeadersFieldProps {
  checked: boolean
  onChange: (checked: boolean) => void
}

export function IncludeHeadersField({ checked, onChange }: IncludeHeadersFieldProps) {
  return (
    <div className="flex cursor-pointer items-center gap-3">
      <Checkbox
        id="export-include-headers"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        data-testid="export-include-headers-checkbox"
      />
      <label htmlFor="export-include-headers" className={DIALOG_CHECKBOX_LABEL}>
        Include column headers in first row
      </label>
    </div>
  )
}

export function ExportError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div className={DIALOG_INLINE_ERROR_BOX} data-testid="export-error">
      {error}
    </div>
  )
}

interface FullExportOutcomeProps {
  exportJob: ResultExportJob | undefined
  failureBarRef: RefObject<HTMLDivElement | null>
  onRetry: () => void
}

export function FullExportOutcome({ exportJob, failureBarRef, onRetry }: FullExportOutcomeProps) {
  if (exportJob?.status === 'cancelled') {
    return (
      <InfoBar
        severity="warning"
        title="Export cancelled"
        message="No file was written."
        data-testid="export-cancelled"
      />
    )
  }
  if (exportJob?.status !== 'failed') return null
  return (
    <InfoBar
      ref={failureBarRef}
      tabIndex={-1}
      severity="error"
      title="Export failed"
      message={exportJob.error}
      detail="No file was written."
      actions={
        <Button type="button" size="sm" onClick={onRetry} data-testid="export-try-again">
          Try again
        </Button>
      }
      data-testid="export-failed"
    />
  )
}

interface ExportFormActionsProps {
  canSubmit: boolean
  isExporting: boolean
  onClose: () => void
}

export function ExportFormActions({ canSubmit, isExporting, onClose }: ExportFormActionsProps) {
  return (
    <div className={joinClassNames([DIALOG_FOOTER_GRID, 'mt-2.5'])}>
      <Button
        type="submit"
        variant="accent"
        disabled={!canSubmit}
        data-testid="export-submit-button"
      >
        {isExporting ? 'Exporting...' : 'Export'}
      </Button>
      <Button type="button" onClick={onClose} data-testid="export-cancel-button">
        Cancel
      </Button>
    </div>
  )
}
