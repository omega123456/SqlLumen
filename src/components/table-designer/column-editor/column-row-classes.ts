import { joinClassNames } from '../../../lib/class-names'

type ColumnRowSurface = 'idle' | 'selected' | 'grabbed' | 'grabbedSelected'

const ROW_SURFACE_CLASSES: Record<ColumnRowSurface, string> = {
  idle: 'hover:bg-light-fill-subtle-hover dark:hover:bg-dark-fill-subtle-hover',
  selected: 'bg-light-fill-accent-tint dark:bg-dark-fill-accent-tint',
  grabbed:
    'relative z-1 bg-light-surface-container shadow-light-flyout dark:bg-dark-surface-container dark:shadow-dark-flyout',
  grabbedSelected:
    'relative z-1 bg-light-surface-container shadow-light-flyout hover:bg-light-fill-accent-tint dark:bg-dark-surface-container dark:shadow-dark-flyout dark:hover:bg-dark-fill-accent-tint',
}

type ColumnRowPointer = 'resting' | 'dragging'

const ROW_POINTER_CLASSES: Record<ColumnRowPointer, string> = {
  resting: 'cursor-grab',
  dragging: 'cursor-grabbing **:cursor-grabbing',
}

type ColumnRowMotion = 'still' | 'sliding' | 'grabbed'

const ROW_MOTION_CLASSES: Record<ColumnRowMotion, string> = {
  still: '',
  sliding: 'transition-transform duration-150',
  grabbed: 'transition-none',
}

export interface ColumnRowLook {
  isSelected: boolean
  isDragging: boolean
  isDragSource: boolean
}

function rowSurface({ isSelected, isDragSource }: ColumnRowLook): ColumnRowSurface {
  if (isDragSource && isSelected) return 'grabbedSelected'
  if (isDragSource) return 'grabbed'
  if (isSelected) return 'selected'
  return 'idle'
}

function rowPointer({ isDragging }: ColumnRowLook): ColumnRowPointer {
  if (isDragging) return 'dragging'
  return 'resting'
}

function rowMotion({ isDragging, isDragSource }: ColumnRowLook): ColumnRowMotion {
  if (isDragSource) return 'grabbed'
  if (isDragging) return 'sliding'
  return 'still'
}

export function columnRowClassName(look: ColumnRowLook): string {
  return joinClassNames([
    'group/row text-light-on-surface dark:text-dark-on-surface',
    ROW_POINTER_CLASSES[rowPointer(look)],
    ROW_SURFACE_CLASSES[rowSurface(look)],
    ROW_MOTION_CLASSES[rowMotion(look)],
  ])
}
