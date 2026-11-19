import { useEffect, useMemo, useRef, useState } from 'react'
import type { DropdownOption } from '../../common/Dropdown'
import { formatCount } from '../../../lib/format-row-count'
import { useQueryStore, type ExportRowScope } from '../../../stores/query-store'
import type { ExportFormat } from '../../../types/schema'
import {
  EXPORT_FORMAT_CONFIG,
  FORMAT_KEYS,
  formatDescription,
  isUnavailableFormat,
  offersAllRowsExport,
  resolveExportResultIndex,
  runningExportJob,
  viewModifiersOf,
} from './export-format'

export interface ExportDialogSource {
  tabId: string
  resultIndex?: number
  hasCustomExport: boolean
  isView?: boolean
}

function useExportResult(source: ExportDialogSource) {
  const { tabId, resultIndex } = source
  const resolvedResultIndex = useQueryStore((state) => {
    const tab = state.tabs[tabId]
    if (!tab) return 0
    return resolveExportResultIndex(tab, resultIndex)
  })
  const result = useQueryStore((state) => state.tabs[tabId]?.results[resolvedResultIndex])
  const exportJob = useQueryStore((state) => state.exportJobs[tabId])
  return { resolvedResultIndex, result, exportJob }
}

function useFormatChoice(isView: boolean | undefined, offersAllRows: boolean) {
  const [format, setFormat] = useState<ExportFormat>('csv')
  if (isUnavailableFormat(format, isView)) {
    setFormat('csv')
  }
  const formatDropdownOptions: DropdownOption<ExportFormat>[] = useMemo(
    () =>
      FORMAT_KEYS.filter((key) => !isUnavailableFormat(key, isView)).map((key) => ({
        value: key,
        label: EXPORT_FORMAT_CONFIG[key].label,
        description: formatDescription(key, offersAllRows),
      })),
    [isView, offersAllRows]
  )
  return { format, setFormat, formatDropdownOptions }
}

function rowScopeOptionsFor(viewRowCount: number): DropdownOption<ExportRowScope>[] {
  return [
    {
      value: 'currentView',
      label: `Current view · ${formatCount(viewRowCount)} rows`,
      description: 'Rows in memory, with the current sort and filter. No re-run.',
    },
    {
      value: 'allRows',
      label: 'All rows · re-runs the query',
      description:
        'Streams every row to file. Sort and filter are not applied. Not limited by the row ceiling.',
    },
  ]
}

function useFailureFocus(exportJobStatus: string | undefined) {
  const failureBarRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (exportJobStatus === 'failed') failureBarRef.current?.focus()
  }, [exportJobStatus])
  return failureBarRef
}

export function useExportDialogState(source: ExportDialogSource) {
  const { resolvedResultIndex, result, exportJob } = useExportResult(source)
  const offersAllRows = offersAllRowsExport(result, source.hasCustomExport)
  const [scope, setScope] = useState<ExportRowScope>(() =>
    offersAllRows && result ? result.view.prompts.exportScope : 'currentView'
  )
  const effectiveScope: ExportRowScope = offersAllRows ? scope : 'currentView'
  const failureBarRef = useFailureFocus(exportJob?.status)
  const formatChoice = useFormatChoice(source.isView, offersAllRows)
  const viewModifiers = viewModifiersOf(result)
  const viewRowCount = viewModifiers.viewRowCount
  const rowScopeOptions = useMemo(() => rowScopeOptionsFor(viewRowCount), [viewRowCount])
  const isAllRows = effectiveScope === 'allRows'
  const runningJob = runningExportJob(exportJob)
  return {
    resolvedResultIndex,
    exportJob,
    offersAllRows,
    setScope,
    effectiveScope,
    isAllRows,
    runningJob,
    failureBarRef,
    ...formatChoice,
    viewModifiers,
    rowScopeOptions,
  }
}
