import type { ReactNode } from 'react'
import { ToolbarDivider } from './ToolbarDivider'

interface DataViewToolbarProps {
  testId: string
  viewMode: ReactNode
  editTarget: ReactNode
  rowActions: ReactNode
  reload?: ReactNode
  dataActions: ReactNode
  paging?: ReactNode
  dialogs: ReactNode
}

function PagingSlot({ paging }: { paging: ReactNode }) {
  if (!paging) return null
  return (
    <>
      <ToolbarDivider />
      {paging}
    </>
  )
}

export function DataViewToolbar(props: DataViewToolbarProps) {
  return (
    <div
      className="@container flex h-command-bar shrink-0 items-center gap-1.5 px-2"
      data-testid={props.testId}
    >
      {props.viewMode}
      {props.editTarget}
      <ToolbarDivider />
      {props.rowActions}
      {props.reload}
      <div className="min-w-0 flex-1" />
      {props.dataActions}
      <PagingSlot paging={props.paging} />
      {props.dialogs}
    </div>
  )
}
