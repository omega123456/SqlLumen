import { describe, expect, it } from 'vitest'
import {
  applyConditionChange,
  isNullaryOperator,
  withConditionChanged,
  withoutConditionAt,
} from '../../../components/dialogs/filter-conditions'
import type { FilterCondition } from '../../../types/schema'

const ageCondition: FilterCondition = { column: 'age', operator: '>', value: '18' }
const nameCondition: FilterCondition = { column: 'name', operator: 'LIKE', value: 'a%' }

describe('isNullaryOperator', () => {
  it('recognises the IS NULL operators only', () => {
    expect(isNullaryOperator('IS NULL')).toBe(true)
    expect(isNullaryOperator('IS NOT NULL')).toBe(true)
    expect(isNullaryOperator('==')).toBe(false)
  })
})

describe('applyConditionChange', () => {
  it('clears the value when switching to a nullary operator', () => {
    const changed = applyConditionChange(ageCondition, {
      index: 0,
      field: 'operator',
      value: 'IS NULL',
    })
    expect(changed).toEqual({ column: 'age', operator: 'IS NULL', value: '' })
  })
})

describe('withConditionChanged', () => {
  it('changes only the condition at the index', () => {
    const conditions = [ageCondition, nameCondition]
    const changed = withConditionChanged(conditions, { index: 1, field: 'value', value: 'b%' })
    expect(changed[0]).toBe(ageCondition)
    expect(changed[1]).toEqual({ column: 'name', operator: 'LIKE', value: 'b%' })
  })
})

describe('withoutConditionAt', () => {
  it('removes the condition at the index', () => {
    expect(withoutConditionAt([ageCondition, nameCondition], 0)).toEqual([nameCondition])
  })
})
