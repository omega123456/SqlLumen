import { CompactSelection } from '@glideapps/glide-data-grid'
import { describe, expect, it } from 'vitest'
import {
  glideSelectionToProcessList,
  processListSelectionToGlide,
  PROCESS_LIST_ROW_MARKER_THEME,
} from '../../../../components/shared/glide/glide-row-markers'
import type { ProcessRow } from '../../../../lib/processlist-commands'

const rows: ProcessRow[] = [
  { id: 1, user: 'u', host: 'h', db: null, command: 'Query', time: 1, state: null, info: null },
  { id: 2, user: 'u', host: 'h', db: null, command: 'Sleep', time: 2, state: null, info: null },
]

describe('glide-row-markers', () => {
  it('defines marker theme', () => {
    expect(PROCESS_LIST_ROW_MARKER_THEME.accentColor).toBeTruthy()
  })
  it('maps process selections to Glide rows', () => {
    const selection = processListSelectionToGlide([2], rows)
    expect(selection.rows.hasIndex(1)).toBe(true)
  })
  it('extracts PIDs from Glide rows', () => {
    const selection = {
      columns: CompactSelection.empty(),
      rows: CompactSelection.empty().add(0).add(1),
    }
    expect(glideSelectionToProcessList(selection, rows)).toEqual([1, 2])
  })
  it('handles empty and no matching rows', () => {
    expect(processListSelectionToGlide([99], rows).rows.length).toBe(0)
    expect(
      glideSelectionToProcessList(
        { columns: CompactSelection.empty(), rows: CompactSelection.empty() },
        rows
      )
    ).toEqual([])
  })
})
