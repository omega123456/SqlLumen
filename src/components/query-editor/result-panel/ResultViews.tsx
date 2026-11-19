import { DataGridView } from '../../shared/data-view/DataGridView'
import { DataFormView } from '../../shared/data-view/DataFormView'
import { DataTextView } from '../../shared/data-view/DataTextView'
import { DataViewModeSwitch } from '../../shared/data-view/DataViewModeSwitch'
import type { DataViewSource } from '../../shared/data-view/data-view-source'
import type { ViewMode } from '../../../types/schema'

export interface ResultViewsProps {
  source: DataViewSource
  mode: ViewMode
}

export function ResultViews({ source, mode }: ResultViewsProps) {
  const remountPerResultKey = source.ref.resultIndex
  return (
    <DataViewModeSwitch
      key={remountPerResultKey}
      mode={mode}
      grid={<DataGridView source={source} />}
      form={<DataFormView source={source} />}
      text={<DataTextView source={source} />}
    />
  )
}
