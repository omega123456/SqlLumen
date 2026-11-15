const EDITING_ROW_CLASS = 'grid-editing-row'
const NEW_ROW_CLASS = 'grid-new-row'
export const SELECTED_ROW_CLASS = 'grid-row-precision-selected'

export interface RowPresentationState {
  isEditing: boolean
  isNewRow: boolean
  isSelected: boolean
}

export function rowClassNameOf(state: RowPresentationState): string | undefined {
  const classes: string[] = []
  const isEditingNewRow = state.isEditing && state.isNewRow
  if (state.isEditing) classes.push(EDITING_ROW_CLASS)
  if (isEditingNewRow) classes.push(NEW_ROW_CLASS)
  if (state.isSelected) classes.push(SELECTED_ROW_CLASS)
  return classes.length > 0 ? classes.join(' ') : undefined
}
