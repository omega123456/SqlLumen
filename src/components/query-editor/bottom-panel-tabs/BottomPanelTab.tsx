import type { MouseEvent } from 'react'
import { CheckCircle, Table, Warning, X } from '@phosphor-icons/react'
import type { SingleResultState } from '../../../stores/query-store'
import { Button } from '../../common/Button'
import { isMiddleMouseButton } from '../../../lib/input-events'
import { hasResultColumns } from '../../../lib/query-result-column-utils'
import type { BottomPanelTabItem } from './bottom-panel-tab-items'
import styles from '../BottomPanelTabs.module.css'
import { joinClassNames } from '../../../lib/class-names'

function getResultTabIcon(result: SingleResultState) {
  if (result.resultStatus === 'error') {
    return (
      <Warning size={12} weight="fill" className={joinClassNames(['shrink-0', styles.errorIcon])} />
    )
  }
  if (!hasResultColumns(result)) {
    return <CheckCircle size={12} weight="fill" className="shrink-0" />
  }
  return <Table size={16} weight="regular" className="shrink-0" />
}

function bottomTabIcon(item: BottomPanelTabItem) {
  if (item.kind === 'result') return getResultTabIcon(item.result)
  return <Table size={16} weight="regular" className="shrink-0" />
}

function bottomTabPanelId(item: BottomPanelTabItem, queryTabId: string): string {
  if (item.kind === 'result') return `result-tabpanel-${queryTabId}-${item.index}`
  return `table-data-tabpanel-${item.tab.id}`
}

function bottomTabTestId(item: BottomPanelTabItem): string {
  if (item.kind === 'result') return `bottom-panel-result-tab-${item.index}`
  return `bottom-panel-table-tab-${item.tab.id}`
}

function bottomTabStateProps(isActive: boolean) {
  return {
    className: `${styles.tab} ${isActive ? styles.tabActive : ''}`,
    'data-active': isActive ? true : undefined,
  }
}

export interface BottomPanelTabProps {
  item: BottomPanelTabItem
  index: number
  queryTabId: string
  isActive: boolean
  showSeparator: boolean
  registerTab: (index: number, element: HTMLButtonElement | null) => void
  onActivate: (item: BottomPanelTabItem) => void
  onCloseTableTab: (tabId: string) => void
}

function TableTabCloseButton({ item, onCloseTableTab }: BottomPanelTabProps) {
  if (item.kind !== 'table-data') return null
  return (
    <Button
      variant="bare"
      className={styles.closeButton}
      aria-label={`Close ${item.tab.label} table`}
      onClick={(event) => {
        event.stopPropagation()
        onCloseTableTab(item.tab.id)
      }}
      data-testid={`bottom-panel-close-${item.tab.id}`}
    >
      <X size={12} weight="regular" />
    </Button>
  )
}

export function BottomPanelTab(props: BottomPanelTabProps) {
  const { item, index, isActive, registerTab, onActivate, onCloseTableTab } = props
  const handleMouseDown = (event: MouseEvent) => {
    if (item.kind !== 'table-data') return
    if (!isMiddleMouseButton(event)) return
    event.preventDefault()
    onCloseTableTab(item.tab.id)
  }
  return (
    <div className={styles.item}>
      {props.showSeparator && (
        <div
          className={styles.separator}
          aria-hidden="true"
          data-testid="bottom-panel-tabs-separator"
        />
      )}
      <div
        {...bottomTabStateProps(isActive)}
        onMouseDown={handleMouseDown}
        data-testid={bottomTabTestId(item)}
      >
        <Button
          variant="bare"
          ref={(element) => registerTab(index, element)}
          role="tab"
          id={item.id}
          aria-selected={isActive}
          aria-controls={bottomTabPanelId(item, props.queryTabId)}
          tabIndex={isActive ? 0 : -1}
          className={styles.tabButton}
          onClick={() => onActivate(item)}
        >
          <span className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap">
            {bottomTabIcon(item)}
            <span className="min-w-0">{item.label}</span>
          </span>
        </Button>
        <TableTabCloseButton {...props} />
      </div>
    </div>
  )
}
