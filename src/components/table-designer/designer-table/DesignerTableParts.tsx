import { Trash } from '@phosphor-icons/react'
import type { HTMLAttributes, MouseEvent as ReactMouseEvent, ReactNode, Ref } from 'react'
import type { TdHTMLAttributes } from 'react'
import { SCROLLBAR, joinClassNames } from '../../../lib/class-names'
import { dataFlag } from '../../../lib/data-attributes'
import { Button } from '../../common/Button'
import type { DesignerAccent } from './designer-accent'

interface DesignerPanelProps {
  testId: string
  ref?: Ref<HTMLDivElement>
  children: ReactNode
}

export function DesignerPanel({ testId, ref, children }: DesignerPanelProps) {
  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid={testId}>
      {children}
    </div>
  )
}

export function DesignerToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-command-bar flex-none items-center gap-1 overflow-hidden px-4 whitespace-nowrap *:shrink-0">
      {children}
    </div>
  )
}

export function DesignerToolbarDivider() {
  return (
    <span
      className="mx-1 h-5 w-px bg-light-stroke-divider dark:bg-dark-stroke-divider"
      aria-hidden
    />
  )
}

export type DesignerTableLayout = 'columns' | 'indexes' | 'foreignKeys'

const TABLE_LAYOUT_CLASSES: Record<DesignerTableLayout, string> = {
  columns: 'w-max min-w-full',
  indexes: 'w-full min-w-190 table-fixed',
  foreignKeys: 'w-full min-w-395 table-fixed',
}

interface DesignerGridCardProps {
  layout: DesignerTableLayout
  scrollerTestId?: string
  children: ReactNode
}

export function DesignerGridCard({ layout, scrollerTestId, children }: DesignerGridCardProps) {
  return (
    <div className="mx-5 mb-4 flex min-h-0 flex-initial flex-col overflow-hidden rounded-card border border-light-stroke-card bg-light-surface-container-high dark:border-dark-stroke-card dark:bg-dark-surface-container-high">
      <div
        className={joinClassNames(['min-h-0 flex-initial overflow-auto', SCROLLBAR])}
        data-testid={scrollerTestId}
      >
        <table
          className={joinClassNames([
            'border-separate border-spacing-0',
            TABLE_LAYOUT_CLASSES[layout],
          ])}
        >
          {children}
        </table>
      </div>
    </div>
  )
}

export interface DesignerHeaderColumn {
  label: string
  widthClassName?: string
  isCentred?: boolean
}

type HeaderAlignment = 'start' | 'centre'

const HEADER_ALIGNMENT_CLASSES: Record<HeaderAlignment, string> = {
  start: 'text-left',
  centre: 'text-center',
}

function headerAlignment(column: DesignerHeaderColumn): HeaderAlignment {
  if (column.isCentred) return 'centre'
  return 'start'
}

export function DesignerTableHead({ columns }: { columns: DesignerHeaderColumn[] }) {
  return (
    <thead className="sticky top-0 z-2">
      <tr>
        {columns.map((column, index) => (
          <th
            key={`${column.label}-${index}`}
            className={joinClassNames([
              'sticky top-0 h-grid-header border-b border-light-stroke-divider bg-light-surface-container px-2 font-body text-size-caption font-semibold whitespace-nowrap text-light-on-surface-variant dark:border-dark-stroke-divider dark:bg-dark-surface-container dark:text-dark-on-surface-variant',
              HEADER_ALIGNMENT_CLASSES[headerAlignment(column)],
              column.widthClassName,
            ])}
            scope="col"
          >
            {column.label}
          </th>
        ))}
      </tr>
    </thead>
  )
}

type DesignerCellInset = 'padded' | 'flush'

const CELL_INSET_CLASSES: Record<DesignerCellInset, string> = {
  padded: 'px-2',
  flush: 'w-4 px-0',
}

type DesignerCellEdge = 'ruled' | 'closing'

const CELL_EDGE_CLASSES: Record<DesignerCellEdge, string> = {
  ruled: 'border-b border-light-stroke-divider dark:border-dark-stroke-divider',
  closing: 'border-b-0',
}

interface DesignerBodyCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  inset?: DesignerCellInset
  edge?: DesignerCellEdge
}

export function DesignerBodyCell({
  inset = 'padded',
  edge = 'ruled',
  className,
  ...rest
}: DesignerBodyCellProps) {
  return (
    <td
      className={joinClassNames([
        'relative py-1.5 align-middle',
        CELL_INSET_CLASSES[inset],
        CELL_EDGE_CLASSES[edge],
        className,
      ])}
      {...rest}
    />
  )
}

const ACCENT_CLASSES: Record<DesignerAccent, string> = {
  idle: 'bg-transparent',
  selected: 'bg-light-primary dark:bg-dark-primary',
  added: 'bg-light-tertiary dark:bg-dark-tertiary',
}

export function DesignerRowAccent({ accent }: { accent: DesignerAccent }) {
  return (
    <span
      className={joinClassNames(['absolute top-0 bottom-0 left-0 w-0.75', ACCENT_CLASSES[accent]])}
      aria-hidden
    />
  )
}

export function DesignerIndicatorCell({ accent }: { accent: DesignerAccent }) {
  return (
    <DesignerBodyCell inset="flush">
      <DesignerRowAccent accent={accent} />
    </DesignerBodyCell>
  )
}

export function DesignerRowNumberCell({ children }: { children: ReactNode }) {
  return (
    <DesignerBodyCell className="w-10 text-center text-light-on-surface-variant dark:text-dark-on-surface-variant">
      {children}
    </DesignerBodyCell>
  )
}

type DesignerRowState = 'idle' | 'selected'

const ROW_STATE_CLASSES: Record<DesignerRowState, string> = {
  idle: 'hover:bg-light-fill-subtle-hover dark:hover:bg-dark-fill-subtle-hover',
  selected: 'bg-light-fill-accent-tint dark:bg-dark-fill-accent-tint',
}

function designerRowState(isSelected: boolean): DesignerRowState {
  if (isSelected) return 'selected'
  return 'idle'
}

interface DesignerRowProps extends HTMLAttributes<HTMLTableRowElement> {
  isSelected: boolean
}

export function DesignerRow({ isSelected, ...rest }: DesignerRowProps) {
  return (
    <tr
      className={joinClassNames([
        'text-light-on-surface dark:text-dark-on-surface',
        ROW_STATE_CLASSES[designerRowState(isSelected)],
      ])}
      data-selected={dataFlag(isSelected)}
      {...rest}
    />
  )
}

export function DesignerDeleteCell({ children }: { children?: ReactNode }) {
  return <DesignerBodyCell className="w-10.5 text-center">{children}</DesignerBodyCell>
}

interface DesignerDeleteButtonProps {
  label: string
  testId: string
  onDelete: () => void
}

export function DesignerDeleteButton({ label, testId, onDelete }: DesignerDeleteButtonProps) {
  const deleteRow = (event: ReactMouseEvent) => {
    event.stopPropagation()
    onDelete()
  }
  return (
    <Button
      variant="subtle"
      size="sm"
      dangerText
      iconOnly
      aria-label={label}
      data-testid={testId}
      onClick={deleteRow}
    >
      <Trash size={14} weight="bold" />
    </Button>
  )
}

export function DesignerFieldError({
  error,
  testId,
}: {
  error: string | undefined
  testId: string
}) {
  if (!error) return null
  return (
    <div
      className="mt-1.5 text-size-caption leading-snug text-light-error dark:text-dark-error"
      data-testid={testId}
    >
      {error}
    </div>
  )
}
