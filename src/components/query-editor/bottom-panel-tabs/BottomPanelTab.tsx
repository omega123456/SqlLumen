import type { MouseEvent } from 'react'
import { CheckCircle, Table, Warning, X } from '@phosphor-icons/react'
import type { SingleResultState } from '../../../stores/query-store'
import { Button } from '../../common/Button'
import { isMiddleMouseButton } from '../../../lib/input-events'
import { hasResultColumns } from '../../../lib/query-result-column-utils'
import type { BottomPanelTabItem } from './bottom-panel-tab-items'
import { joinClassNames } from '../../../lib/class-names'
import { dataFlag } from '../../../lib/data-attributes'
import { FOCUS_RING } from '../../../lib/focus-ring'
import {
  RESULT_TAB_ACTIVITY_CLASSES,
  RESULT_TAB_FRAME,
  resultTabActivityOf,
  type ResultTabActivity,
} from '../../../lib/class-names-result-tab'

const TAB_ACTIVITY_CLASSES: Record<ResultTabActivity, string> = {
  idle: RESULT_TAB_ACTIVITY_CLASSES.idle,
  active: joinClassNames([
    RESULT_TAB_ACTIVITY_CLASSES.active,
    'svg:text-light-primary dark:svg:text-dark-primary',
  ]),
}

const ERROR_ICON_TONE_CLASSES: Record<ResultTabActivity, string> = {
  idle: 'text-light-error dark:text-dark-error',
  active: '',
}

function getResultTabIcon(result: SingleResultState, activity: ResultTabActivity) {
  if (result.resultStatus === 'error') {
    return (
      <Warning
        size={12}
        weight="fill"
        className={joinClassNames(['shrink-0', ERROR_ICON_TONE_CLASSES[activity]])}
      />
    )
  }
  if (!hasResultColumns(result.view.slot)) {
    return <CheckCircle size={12} weight="fill" className="shrink-0" />
  }
  return <Table size={16} weight="regular" className="shrink-0" />
}

function bottomTabIcon(item: BottomPanelTabItem, activity: ResultTabActivity) {
  if (item.kind === 'result') return getResultTabIcon(item.result, activity)
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
    className: joinClassNames([
      'group/bottom-tab',
      RESULT_TAB_FRAME,
      TAB_ACTIVITY_CLASSES[resultTabActivityOf(isActive)],
    ]),
    'data-active': dataFlag(isActive),
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
      className={joinClassNames([
        'mr-2 -ml-1.5 size-5 cursor-pointer self-center text-light-outline group-not-data-active/bottom-tab:not-group-hover/bottom-tab:invisible dark:text-dark-outline',
        FOCUS_RING,
      ])}
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
  const activity = resultTabActivityOf(isActive)
  const handleMouseDown = (event: MouseEvent) => {
    if (item.kind !== 'table-data') return
    if (!isMiddleMouseButton(event)) return
    event.preventDefault()
    onCloseTableTab(item.tab.id)
  }
  return (
    <div className="flex shrink-0 items-stretch">
      {props.showSeparator && (
        <div
          className="mx-1.5 h-5 w-px shrink-0 self-center bg-light-stroke-divider dark:bg-dark-stroke-divider"
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
          className={joinClassNames([
            'flex h-full min-w-0 flex-1 cursor-pointer items-center px-3.5 text-left whitespace-nowrap',
            FOCUS_RING,
          ])}
          onClick={() => onActivate(item)}
        >
          <span className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap">
            {bottomTabIcon(item, activity)}
            <span className="min-w-0">{item.label}</span>
          </span>
        </Button>
        <TableTabCloseButton {...props} />
      </div>
    </div>
  )
}
