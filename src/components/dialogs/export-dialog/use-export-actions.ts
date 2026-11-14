import { useCallback, useState } from 'react'
import { exportResults } from '../../../lib/export-commands'
import { toErrorMessage } from '../../../lib/error-message'
import { useBrowseFilePath } from '../../../hooks/useBrowseFilePath'
import { useQueryStore } from '../../../stores/query-store'
import type { ExportFormat, ExportOptions } from '../../../types/schema'
import {
  DEFAULT_EXPORT_TABLE_NAME,
  EXPORT_FORMAT_CONFIG,
  RESULTS_EXPIRED_ERROR_MARKER,
  keepTableNameForSqlInsertOnly,
} from './export-format'

export interface ExportDialogProps {
  connectionId: string
  tabId: string
  onClose: () => void
  resultIndex?: number
  onExport?: (options: Required<ExportOptions>) => Promise<void>
  defaultTableName?: string
  isView?: boolean
}

interface ExportActionsInput {
  props: ExportDialogProps
  format: ExportFormat
  isAllRows: boolean
  resolvedResultIndex: number
}

interface CurrentViewExportRequest {
  props: ExportDialogProps
  requestedOptions: Required<ExportOptions>
  backendOptions: ExportOptions
}

function exportCurrentView(request: CurrentViewExportRequest): Promise<unknown> {
  const { props, requestedOptions, backendOptions } = request
  if (props.onExport) return props.onExport(requestedOptions)
  return exportResults({
    connectionId: props.connectionId,
    tabId: props.tabId,
    options: backendOptions,
    resultIndex: props.resultIndex,
  })
}

function useExportFormFields(props: ExportDialogProps) {
  const { filePath, setFilePath, browseForFilePath } = useBrowseFilePath('export-dialog')
  const [includeHeaders, setIncludeHeaders] = useState(true)
  const [tableName, setTableName] = useState(props.defaultTableName ?? DEFAULT_EXPORT_TABLE_NAME)
  return {
    filePath,
    setFilePath,
    browseForFilePath,
    includeHeaders,
    setIncludeHeaders,
    tableName,
    setTableName,
  }
}

function useRetryFullExport(tabId: string) {
  const exportJob = useQueryStore((state) => state.exportJobs[tabId])
  const startFullExport = useQueryStore((state) => state.startFullExport)
  return useCallback(() => {
    if (!exportJob) return
    void startFullExport(tabId, {
      connectionId: exportJob.connectionId,
      resultIndex: exportJob.resultIndex,
      format: exportJob.format,
      filePath: exportJob.filePath,
      includeHeaders: exportJob.includeHeaders,
      tableName: exportJob.tableName,
    })
  }, [exportJob, startFullExport, tabId])
}

export function useExportActions(input: ExportActionsInput) {
  const { props, format, isAllRows, resolvedResultIndex } = input
  const { connectionId, tabId, onClose } = props
  const fields = useExportFormFields(props)
  const { filePath, includeHeaders, tableName, browseForFilePath } = fields
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const startFullExport = useQueryStore((state) => state.startFullExport)
  const markResultExpired = useQueryStore((state) => state.markResultExpired)
  const handleRetryFullExport = useRetryFullExport(tabId)

  const handleBrowse = useCallback(() => {
    const config = EXPORT_FORMAT_CONFIG[format]
    return browseForFilePath({
      defaultPath: `query_results_${Date.now()}.${config.extension}`,
      filterName: config.label,
      extension: config.extension,
    })
  }, [browseForFilePath, format])

  const handleExport = async () => {
    if (!filePath) return
    const requestedOptions: Required<ExportOptions> = {
      format,
      filePath,
      includeHeaders,
      tableName,
    }
    const backendOptions = keepTableNameForSqlInsertOnly(requestedOptions)
    setError(null)
    if (isAllRows) {
      await startFullExport(tabId, {
        ...backendOptions,
        connectionId: connectionId,
        resultIndex: resolvedResultIndex,
      })
      return
    }
    setIsExporting(true)
    try {
      await exportCurrentView({ props, requestedOptions, backendOptions })
      onClose()
    } catch (exportError) {
      const errorMessage = toErrorMessage(exportError)
      if (errorMessage.includes(RESULTS_EXPIRED_ERROR_MARKER)) {
        markResultExpired(tabId, resolvedResultIndex)
      }
      setError(errorMessage)
    } finally {
      setIsExporting(false)
    }
  }

  return {
    ...fields,
    isExporting,
    error,
    handleBrowse,
    handleExport,
    handleRetryFullExport,
  }
}
