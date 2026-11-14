import { useCallback, useEffect, useMemo, useState } from 'react'
import { save } from '@tauri-apps/plugin-dialog'
import { exportLogs } from '../../../lib/log-commands'
import { showErrorToast, showSuccessToast } from '../../../stores/toast-store'
import { toErrorMessage } from '../../../lib/error-message'
import { useFormSubmit } from '../../../hooks/useFormSubmit'
import {
  EMPTY_LOG_DATE_RANGE,
  formatDate,
  getEventInputValue,
  getValidationMessage,
  parseInputDate,
  type LogDateRange,
} from './log-export-model'

const CSV_FILE_FILTERS = [{ name: 'CSV files', extensions: ['csv'] }]

type RangeEdge = keyof LogDateRange

function pickExportPath(from: Date, to: Date): Promise<string | null> {
  return save({
    defaultPath: `sqllumen_logs_${formatDate(from)}_${formatDate(to)}.csv`,
    filters: CSV_FILE_FILTERS,
  })
}

async function writeLogExport(from: Date, to: Date, filePath: string): Promise<boolean> {
  try {
    await exportLogs(formatDate(from), formatDate(to), filePath)
    showSuccessToast('Export completed', `Logs saved to ${filePath}`)
    return true
  } catch (error) {
    showErrorToast('Export failed', toErrorMessage(error))
    return false
  }
}

interface LogExportState {
  range: LogDateRange
  busy: boolean
}

const IDLE_LOG_EXPORT: LogExportState = { range: EMPTY_LOG_DATE_RANGE, busy: false }

function useLogExportState() {
  const [state, setState] = useState<LogExportState>(IDLE_LOG_EXPORT)
  const setEdge = useCallback((edge: RangeEdge, date: Date | null) => {
    setState((current) => ({ ...current, range: { ...current.range, [edge]: date } }))
  }, [])
  const setEdgeFromRawInput = useCallback(
    (edge: RangeEdge, event: unknown) => {
      const nextValue = getEventInputValue(event)
      if (nextValue === null) return
      setEdge(edge, parseInputDate(nextValue))
    },
    [setEdge]
  )
  const setBusy = useCallback((busy: boolean) => {
    setState((current) => ({ ...current, busy: busy }))
  }, [])
  const reset = useCallback(() => setState(IDLE_LOG_EXPORT), [])
  return { state, setEdge, setEdgeFromRawInput, setBusy, reset }
}

export function useLogExport(isOpen: boolean, onClose: () => void) {
  const { state, setEdge, setEdgeFromRawInput, setBusy, reset } = useLogExportState()
  const { range, busy } = state
  const { from, to } = range
  useEffect(() => {
    if (!isOpen) reset()
  }, [isOpen, reset])

  const validationMessage = useMemo(() => getValidationMessage(from, to), [from, to])

  const handleExport = useCallback(async () => {
    if (!from) return
    if (!to) return
    if (validationMessage !== null) return
    if (busy) return
    const filePath = await pickExportPath(from, to)
    if (!filePath) return
    setBusy(true)
    const exported = await writeLogExport(from, to, filePath)
    if (exported) onClose()
    setBusy(false)
  }, [busy, from, onClose, to, validationMessage, setBusy])

  return {
    range: range,
    busy: busy,
    validationMessage: validationMessage,
    canExport: !busy && validationMessage === null,
    setEdge: setEdge,
    setEdgeFromRawInput: setEdgeFromRawInput,
    handleSubmit: useFormSubmit(handleExport),
  }
}
