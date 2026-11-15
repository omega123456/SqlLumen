export type DesignerAccent = 'idle' | 'selected' | 'added'

export function selectedAccent(isSelected: boolean): DesignerAccent {
  if (isSelected) return 'selected'
  return 'idle'
}
