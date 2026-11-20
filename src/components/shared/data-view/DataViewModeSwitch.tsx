import type { ReactNode } from 'react'
import type { ViewMode } from '../../../types/shared-data-view'
import { RetainedView } from '../RetainedView'

interface DataViewModeSwitchProps {
  mode: ViewMode
  grid: ReactNode
  form: ReactNode
  text?: ReactNode
}

export function DataViewModeSwitch({ mode, grid, form, text = null }: DataViewModeSwitchProps) {
  return (
    <>
      <RetainedView isVisible={mode === 'grid'}>{grid}</RetainedView>
      {mode === 'form' && form}
      <RetainedView isVisible={mode === 'text'}>{text}</RetainedView>
    </>
  )
}
