import { CompactSelection, type GridSelection, type Theme } from '@glideapps/glide-data-grid'
import type { ProcessRow } from '../../../lib/processlist-commands'

export const PROCESS_LIST_ROW_MARKER_THEME: Partial<Theme> = {
  accentColor: 'var(--primary)',
  accentLight: 'rgba(var(--primary-rgb), 0.12)',
  textMedium: 'var(--on-surface-variant)',
}

export function processListSelectionToGlide(
  selectedPids: number[],
  rows: ProcessRow[]
): GridSelection {
  const selected = new Set(selectedPids)
  let rowSelection = CompactSelection.empty()
  rows.forEach((row, index) => {
    if (selected.has(row.id)) rowSelection = rowSelection.add(index)
  })
  return { columns: CompactSelection.empty(), rows: rowSelection }
}

export function glideSelectionToProcessList(
  selection: GridSelection,
  rows: ProcessRow[]
): number[] {
  const pids: number[] = []
  for (const rowIndex of selection.rows) {
    const row = rows[rowIndex]
    if (row) pids.push(row.id)
  }
  return pids
}
