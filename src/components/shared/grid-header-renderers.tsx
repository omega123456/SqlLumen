import { ArrowDown, ArrowUp, Link, Lock } from '@phosphor-icons/react'
import type { GridSortDirection } from './glide/glide-grid-types'

export interface SortStatusRendererProps {
  sortDirection?: GridSortDirection | null
  priority?: number
}

export interface HeaderCellRendererProps {
  column: { name?: React.ReactNode; key?: string }
  sortDirection?: GridSortDirection | null
  tabIndex?: number
}

export function SortStatusRenderer({ sortDirection }: SortStatusRendererProps) {
  if (sortDirection === 'ASC') {
    return <ArrowUp size={12} weight="bold" className="opacity-60" />
  }
  if (sortDirection === 'DESC') {
    return <ArrowDown size={12} weight="bold" className="opacity-60" />
  }
  return null
}

function HeaderCellWithIcon(props: HeaderCellRendererProps & { icon: React.ReactNode }) {
  const { column, sortDirection, tabIndex, icon } = props
  const columnName = typeof column.name === 'string' ? column.name : (column.key ?? '')

  return (
    <div className="flex w-full items-center gap-1 overflow-hidden" tabIndex={tabIndex}>
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{columnName}</span>
      {icon}
      <SortStatusRenderer sortDirection={sortDirection} />
    </div>
  )
}

export function ReadOnlyColumnHeaderCell(props: HeaderCellRendererProps) {
  return (
    <HeaderCellWithIcon
      {...props}
      icon={<Lock size={10} weight="bold" className="shrink-0 opacity-50" />}
    />
  )
}

export function ForeignKeyColumnHeaderCell(props: HeaderCellRendererProps) {
  return (
    <HeaderCellWithIcon
      {...props}
      icon={<Link size={10} weight="bold" className="shrink-0 opacity-50" />}
    />
  )
}
