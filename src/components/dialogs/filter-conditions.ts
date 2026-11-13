import type { FilterCondition } from '../../types/schema'

const NULLARY_OPERATORS = new Set<string>(['IS NULL', 'IS NOT NULL'])

export interface ConditionChange {
  index: number
  field: keyof FilterCondition
  value: string
}

export function isNullaryOperator(operator: string): boolean {
  return NULLARY_OPERATORS.has(operator)
}

function clearsValue(change: ConditionChange): boolean {
  const isOperatorChange = change.field === 'operator'
  return isOperatorChange && isNullaryOperator(change.value)
}

export function applyConditionChange(
  condition: FilterCondition,
  change: ConditionChange
): FilterCondition {
  const updated = { ...condition, [change.field]: change.value }
  if (clearsValue(change)) return { ...updated, value: '' }
  return updated
}

export function withConditionChanged(
  conditions: FilterCondition[],
  change: ConditionChange
): FilterCondition[] {
  return conditions.map((condition, conditionIndex) => {
    if (conditionIndex !== change.index) return condition
    return applyConditionChange(condition, change)
  })
}

export function withoutConditionAt(
  conditions: FilterCondition[],
  index: number
): FilterCondition[] {
  return conditions.filter((_condition, conditionIndex) => conditionIndex !== index)
}
