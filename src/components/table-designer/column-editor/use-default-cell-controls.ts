import { useEffect, useRef, useState, type RefObject } from 'react'
import type { DefaultValueModel } from '../../../types/schema'
import { editStartKey, type ActiveCell } from '../column-editor-model'
import type { DefaultCellControls } from '../ColumnEditorRow'
import { openOverrideTrigger } from './column-editor-dom'
import type { EditStartValues } from './use-edit-start-values'

type BlurTimers = Map<number, ReturnType<typeof setTimeout>>

function clearBlurTimers(timers: BlurTimers): void {
  timers.forEach(clearTimeout)
  timers.clear()
}

function cancelBlurTimer(timers: BlurTimers, columnIndex: number): void {
  const timer = timers.get(columnIndex)
  if (timer === undefined) return
  clearTimeout(timer)
  timers.delete(columnIndex)
}

function markOverrideOpened(openedRef: RefObject<boolean>, isOpened: boolean): void {
  openedRef.current = isOpened
}

export function useDefaultCellControls(editStart: EditStartValues) {
  const [defaultModeOverrideIndex, setDefaultModeOverrideIndex] = useState<number | null>(null)
  const defaultOverrideTriggerRef = useRef<HTMLButtonElement | null>(null)
  const defaultCellBlurTimersRef = useRef<BlurTimers>(new Map())
  const defaultOverrideOpenedRef = useRef(false)

  const scheduleDefaultCellBlur = (columnIndex: number) => {
    const timer = setTimeout(() => {
      editStart.forgetEditStart({ rowIndex: columnIndex, cellKey: 'default' })
      defaultCellBlurTimersRef.current.delete(columnIndex)
    }, 0)
    defaultCellBlurTimersRef.current.set(columnIndex, timer)
  }

  const captureDefaultBaseline = (columnIndex: number, defaultValue: DefaultValueModel) => {
    cancelBlurTimer(defaultCellBlurTimersRef.current, columnIndex)
    const cell: ActiveCell = { rowIndex: columnIndex, cellKey: 'default' }
    const hasNoBaseline = editStart.editStartValue(editStartKey(cell)) === undefined
    if (hasNoBaseline) {
      editStart.rememberEditStart(cell, JSON.stringify(defaultValue))
    }
  }

  const handleOverrideOpenChange = (open: boolean) => {
    if (open) {
      markOverrideOpened(defaultOverrideOpenedRef, true)
      return
    }
    if (defaultOverrideOpenedRef.current) {
      setDefaultModeOverrideIndex(null)
    }
  }

  useEffect(() => {
    if (defaultModeOverrideIndex === null) return
    markOverrideOpened(defaultOverrideOpenedRef, false)
    const handle = requestAnimationFrame(() => openOverrideTrigger(defaultOverrideTriggerRef))
    return () => cancelAnimationFrame(handle)
  }, [defaultModeOverrideIndex])

  useEffect(() => {
    const timers = defaultCellBlurTimersRef.current
    return () => clearBlurTimers(timers)
  }, [])

  const defaultCell: DefaultCellControls = {
    overrideIndex: defaultModeOverrideIndex,
    overrideTriggerRef: defaultOverrideTriggerRef,
    captureBaseline: captureDefaultBaseline,
    scheduleBlur: scheduleDefaultCellBlur,
    openOverride: setDefaultModeOverrideIndex,
    closeOverride: () => setDefaultModeOverrideIndex(null),
    handleOverrideOpenChange: handleOverrideOpenChange,
  }

  return {
    defaultCell: defaultCell,
    setDefaultModeOverrideIndex: setDefaultModeOverrideIndex,
    clearDefaultCellBlurTimers: () => clearBlurTimers(defaultCellBlurTimersRef.current),
  }
}
