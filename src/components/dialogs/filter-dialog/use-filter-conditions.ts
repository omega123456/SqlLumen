import { useCallback, useEffect, useRef, useState } from 'react'
import type { FilterCondition, FilterOperator } from '../../../types/schema'
import { withConditionChanged, withoutConditionAt } from '../filter-conditions'

const DEFAULT_OPERATOR: FilterOperator = '=='

function isFocusableInput(input: HTMLInputElement | null): input is HTMLInputElement {
  if (!input) return false
  return !input.disabled
}

function copyConditions(conditions: FilterCondition[]): FilterCondition[] {
  return conditions.map((condition) => ({ ...condition }))
}

function copyConditionsWhenOpen(
  isOpen: boolean,
  initialConditions: FilterCondition[]
): FilterCondition[] {
  if (!isOpen) return []
  return copyConditions(initialConditions)
}

interface FilterConditionsInputs {
  isOpen: boolean
  initialConditions: FilterCondition[]
  columns: string[]
}

function useConditionsSyncedToOpen({ isOpen, initialConditions }: FilterConditionsInputs) {
  const [conditions, setConditions] = useState<FilterCondition[]>(() =>
    copyConditionsWhenOpen(isOpen, initialConditions)
  )
  const [syncedOpenState, setSyncedOpenState] = useState({ isOpen, initialConditions })

  const hasOpenStateChanged =
    syncedOpenState.isOpen !== isOpen || syncedOpenState.initialConditions !== initialConditions
  if (hasOpenStateChanged) {
    setSyncedOpenState({ isOpen, initialConditions })
  }
  const shouldResetConditions = hasOpenStateChanged && isOpen
  if (shouldResetConditions) {
    setConditions(copyConditions(initialConditions))
  }
  return { conditions: conditions, setConditions: setConditions }
}

function useAutoFocusFirstValue(inputs: FilterConditionsInputs, conditions: FilterCondition[]) {
  const { isOpen, initialConditions } = inputs
  const valueInputRefs = useRef<(HTMLInputElement | null)[]>([])
  const hasAutoFocusedForOpenRef = useRef(false)

  useEffect(() => {
    hasAutoFocusedForOpenRef.current = false
  }, [isOpen, initialConditions])

  useEffect(() => {
    if (!isOpen) return
    if (conditions.length === 0) return
    if (hasAutoFocusedForOpenRef.current) return

    const firstFocusableInput = valueInputRefs.current.find(isFocusableInput)
    if (!firstFocusableInput) return

    let innerFrameId = 0
    const frameId = requestAnimationFrame(() => {
      innerFrameId = requestAnimationFrame(() => {
        firstFocusableInput.focus()
        firstFocusableInput.select()
        hasAutoFocusedForOpenRef.current = true
      })
    })

    return () => {
      cancelAnimationFrame(frameId)
      cancelAnimationFrame(innerFrameId)
    }
  }, [conditions, isOpen])

  return useCallback((index: number, element: HTMLInputElement | null) => {
    valueInputRefs.current[index] = element
  }, [])
}

export function useFilterConditions(inputs: FilterConditionsInputs) {
  const { conditions, setConditions } = useConditionsSyncedToOpen(inputs)
  const registerValueInput = useAutoFocusFirstValue(inputs, conditions)
  const defaultColumn = inputs.columns[0] ?? ''

  const add = useCallback(() => {
    setConditions((previous) => [
      ...previous,
      { column: defaultColumn, operator: DEFAULT_OPERATOR, value: '' },
    ])
  }, [defaultColumn, setConditions])

  const remove = useCallback(
    (index: number) => {
      setConditions((previous) => withoutConditionAt(previous, index))
    },
    [setConditions]
  )

  const change = useCallback(
    (index: number, field: keyof FilterCondition, value: string) => {
      const conditionChange = { index: index, field: field, value: value }
      setConditions((previous) => withConditionChanged(previous, conditionChange))
    },
    [setConditions]
  )

  return {
    conditions: conditions,
    registerValueInput: registerValueInput,
    add: add,
    remove: remove,
    change: change,
    clearAll: () => setConditions([]),
  }
}
