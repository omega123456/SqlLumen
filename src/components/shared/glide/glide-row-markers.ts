import { CompactSelection, type GridSelection, type Theme } from '@glideapps/glide-data-grid'
import type { ProcessRow } from '../../../lib/processlist-commands'
import { readThemeColor } from '../../../lib/theme-tokens'

export function processListRowMarkerTheme(): Partial<Theme> {
  return {
    accentColor: readThemeColor('primary'),
    accentLight: readThemeColor('primary-a12'),
    textMedium: readThemeColor('on-surface-variant'),
  }
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
