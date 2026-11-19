import { resultState } from '../../helpers/legacy-result-fields'
import { describe, expect, it } from 'vitest'
import { makeTabState } from '../../helpers/query-test-utils'
import {
  hasOpenExportDialog,
  hasResultAt,
  hasResults,
  isSameResultList,
} from '../../../stores/query-store/result-lists'

const firstResult = resultState({})
const secondResult = resultState({})
const DEFAULT_TAB_STATE = makeTabState()

describe('result list predicates', () => {
  it('compares result lists by element identity', () => {
    expect(isSameResultList([firstResult], [firstResult])).toBe(true)
    expect(isSameResultList([secondResult], [firstResult])).toBe(false)
  })

  it('detects tabs with results and valid indexes', () => {
    const tab = { ...DEFAULT_TAB_STATE, results: [firstResult] }
    expect(hasResults(undefined)).toBe(false)
    expect(hasResults({ ...DEFAULT_TAB_STATE, results: [] })).toBe(false)
    expect(hasResults(tab)).toBe(true)
    expect(hasResultAt(undefined, 0)).toBe(false)
    expect(hasResultAt(tab, 0)).toBe(true)
    expect(hasResultAt(tab, 1)).toBe(false)
  })

  it('detects an open export dialog on any result', () => {
    const closedTab = { ...DEFAULT_TAB_STATE, results: [firstResult] }
    const openTab = {
      ...DEFAULT_TAB_STATE,
      results: [firstResult, resultState({ exportDialogOpen: true })],
    }
    expect(hasOpenExportDialog(undefined)).toBe(false)
    expect(hasOpenExportDialog(closedTab)).toBe(false)
    expect(hasOpenExportDialog(openTab)).toBe(true)
  })
})
