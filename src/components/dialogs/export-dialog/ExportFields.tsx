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
import styles from '../ExportDialog.module.css'

const HEADER_ICON_SIZE = 20

interface FullExportProgressProps {
  exportJob: ResultExportJob
  onCancel: () => void
}

export function FullExportProgress({ exportJob, onCancel }: FullExportProgressProps) {
  return (
    <div className={styles.body}>
      <div className={styles.progressSection} data-testid="export-progress">
        <span className={styles.progressTitle} role="status">
          Exporting all rows…
        </span>
        <div className={styles.progressBar} aria-hidden="true">
          <div className={styles.progressIndicator} />
        </div>
        <span className={styles.progressStats} data-testid="export-progress-stats">
          {exportProgressText(exportJob)}
        </span>
      </div>
      <div className={`${styles.actions} ${styles.progressActions}`}>
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
    <div className={styles.fieldGroup}>
      <label className={styles.label} id="export-rows-label">
        Rows
      </label>
      <Dropdown
        id="export-rows"
        labelledBy="export-rows-label"
        options={options}
        value={value}
        onChange={onChange}
        data-testid="export-rows-select"
        className={styles.formatDropdownRoot}
        triggerClassName={styles.formatDropdownTrigger}
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
    <div className={styles.fieldGroup}>
      <label className={styles.label} htmlFor="export-table-name">
        Table name
      </label>
      <TextInput
        id="export-table-name"
        variant="bare"
        type="text"
        className={styles.tableNameInput}
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
    <div className={styles.header}>
      <h2 className={styles.title}>Export results</h2>
      {canClose && (
        <Button variant="bare" className={styles.closeButton} onClick={onClose} aria-label="Close">
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
    <div className={styles.fieldGroup}>
      <label className={styles.label} id="export-format-label">
        Format
      </label>
      <Dropdown
        id="export-format"
        labelledBy="export-format-label"
        options={options}
        value={format}
        onChange={onChange}
        data-testid="export-format-select"
        className={styles.formatDropdownRoot}
        triggerClassName={styles.formatDropdownTrigger}
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
    <div className={styles.fieldGroup}>
      <label className={styles.label} htmlFor="export-file-path">
        Destination
      </label>
      <div className={styles.destinationGroup}>
        <span className={styles.destinationPrefix}>.{extension}</span>
        <TextInput
          id="export-file-path"
          variant="bare"
          type="text"
          className={styles.destinationInput}
          value={filePath}
          onChange={(event) => onChange(event.target.value)}
          placeholder={`query_results.${extension}`}
          data-testid="export-file-path-input"
        />
        <Button
          variant="bare"
          className={styles.browseButton}
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
    <div className={styles.checkboxRow}>
      <Checkbox
        id="export-include-headers"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        data-testid="export-include-headers-checkbox"
      />
      <label htmlFor="export-include-headers" className={styles.checkboxLabel}>
        Include column headers in first row
      </label>
    </div>
  )
}

export function ExportError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div className={styles.error} data-testid="export-error">
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
    <div className={styles.actions}>
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
