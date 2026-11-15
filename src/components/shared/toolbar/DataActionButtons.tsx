import type { ExportButtonProps } from '../../../types/shared-data-view'
import { FilterToolbarButton, type FilterToolbarButtonProps } from '../FilterToolbarButton'
import { CopySelectedRowsButton, type CopySelectedRowsButtonProps } from './CopySelectedRowsButton'
import { ExportButton } from './ExportButton'

interface DataActionButtonsProps {
  filter: FilterToolbarButtonProps
  exportAction: ExportButtonProps
  copySelected: CopySelectedRowsButtonProps
}

export function DataActionButtons({ filter, exportAction, copySelected }: DataActionButtonsProps) {
  return (
    <>
      <FilterToolbarButton {...filter} />
      <ExportButton {...exportAction} />
      <CopySelectedRowsButton {...copySelected} />
    </>
  )
}
