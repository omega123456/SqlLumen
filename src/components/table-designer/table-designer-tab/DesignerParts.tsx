import type { ReactNode } from 'react'
import { Wrench } from '@phosphor-icons/react'
import type { DesignerSubTab } from '../../../types/schema'
import { Button } from '../../common/Button'
import { TextInput } from '../../common/TextInput'
import { UnderlineTab, UnderlineTabBar } from '../../common/UnderlineTabs'
import { ColumnEditor } from '../ColumnEditor'
import { DdlPreviewTab } from '../DdlPreviewTab'
import { ForeignKeyEditor } from '../ForeignKeyEditor'
import { IndexEditor } from '../IndexEditor'
import { TablePropertiesEditor } from '../TablePropertiesEditor'
import {
  SUB_TAB_LABELS,
  SUB_TAB_ORDER,
  isApplyDisabled,
  pluralizeColumns,
  type DesignerTabView,
} from './designer-tab-view'
import { ACCENT_TILE } from '../../../lib/class-names-tile'

function DesignerHeadingText({ children }: { children: ReactNode }) {
  return (
    <h1 className="truncate font-headline text-subtitle font-semibold text-light-on-surface dark:text-dark-on-surface">
      {children}
    </h1>
  )
}

interface DesignerHeadingProps {
  isCreateMode: boolean
  tableName: string
  objectName: string
  onTableNameChange: (name: string) => void
}

function DesignerHeading({
  isCreateMode,
  tableName,
  objectName,
  onTableNameChange,
}: DesignerHeadingProps) {
  if (!isCreateMode) {
    return <DesignerHeadingText>Alter table {tableName || objectName}</DesignerHeadingText>
  }
  return (
    <>
      <DesignerHeadingText>Create table</DesignerHeadingText>
      <TextInput
        variant="accentName"
        type="text"
        value={tableName}
        placeholder="table_name"
        data-testid="table-designer-name-input"
        onChange={(event) => onTableNameChange(event.target.value)}
      />
    </>
  )
}

interface SubTabContentProps {
  tabId: string
  connectionId: string
  databaseName: string
}

const SUB_TAB_CONTENT: Record<DesignerSubTab, (props: SubTabContentProps) => ReactNode> = {
  columns: ({ tabId }) => <ColumnEditor tabId={tabId} />,
  indexes: ({ tabId }) => <IndexEditor tabId={tabId} />,
  fks: ({ tabId }) => <ForeignKeyEditor tabId={tabId} />,
  properties: ({ tabId, connectionId, databaseName }) => (
    <TablePropertiesEditor tabId={tabId} connectionId={connectionId} databaseName={databaseName} />
  ),
  ddl: ({ tabId }) => <DdlPreviewTab tabId={tabId} />,
}

type DesignerStatus = 'loading' | 'error'

const STATUS_PANEL_CLASSES: Record<DesignerStatus, string> = {
  loading:
    'mx-5 my-3 flex min-h-60 flex-col items-center justify-center gap-2 rounded-card border border-light-stroke-card text-light-on-surface-variant dark:border-dark-stroke-card dark:text-dark-on-surface-variant',
  error:
    'mx-5 my-3 flex min-h-60 items-center justify-center rounded-card border border-light-stroke-card p-6 text-light-error dark:border-dark-stroke-card dark:text-dark-error',
}

interface DesignerContentProps {
  view: DesignerTabView
  subTab: SubTabContentProps
}

export function DesignerContent({ view, subTab }: DesignerContentProps) {
  if (view.loadError) {
    return (
      <div className={STATUS_PANEL_CLASSES.error} data-testid="table-designer-error">
        {view.loadError}
      </div>
    )
  }

  if (view.isLoading) {
    return (
      <div className={STATUS_PANEL_CLASSES.loading} data-testid="table-designer-loading">
        <div
          className="size-6 animate-spin-850ms rounded-pill border-2 border-light-stroke-card border-t-light-primary window-blurred:animate-spin-850ms-paused dark:border-dark-stroke-card dark:border-t-dark-primary"
          aria-hidden
        />
        <span>Loading table schema...</span>
      </div>
    )
  }

  const renderSubTab = SUB_TAB_CONTENT[view.selectedSubTab]
  return renderSubTab(subTab)
}

interface DesignerHeaderProps {
  view: DesignerTabView
  objectName: string
  databaseName: string
  onTableNameChange: (name: string) => void
  onDiscard: () => void
  onApply: () => void
}

export function DesignerHeader(header: DesignerHeaderProps) {
  const { view } = header
  return (
    <div className="flex items-center gap-3 px-5 pt-4 pb-1.5" data-testid="table-designer-header">
      <span className={ACCENT_TILE} aria-hidden>
        <Wrench size={16} weight="regular" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <DesignerHeading
          isCreateMode={view.mode === 'create'}
          tableName={view.tableName}
          objectName={header.objectName}
          onTableNameChange={header.onTableNameChange}
        />
        <span
          className="text-size-caption leading-5 text-light-on-surface-variant dark:text-dark-on-surface-variant"
          data-testid="table-designer-caption"
        >
          {header.databaseName} · {pluralizeColumns(view.columnCount)}
        </span>
      </div>
      <Button
        onClick={header.onDiscard}
        disabled={!view.isDirty}
        data-testid="table-designer-discard"
      >
        Discard
      </Button>
      <Button
        variant="accent"
        disabled={isApplyDisabled(view)}
        onClick={header.onApply}
        data-testid="table-designer-apply"
      >
        Apply changes
      </Button>
    </div>
  )
}

interface DesignerSubTabBarProps {
  selectedSubTab: DesignerSubTab
  onSelect: (subTab: DesignerSubTab) => void
}

export function DesignerSubTabBar({ selectedSubTab, onSelect }: DesignerSubTabBarProps) {
  return (
    <UnderlineTabBar rowHeight="tall" className="px-3" data-testid="table-designer-subtabs">
      {SUB_TAB_ORDER.map((subTabKey) => (
        <UnderlineTab
          key={subTabKey}
          active={selectedSubTab === subTabKey}
          data-testid={`table-designer-subtab-${subTabKey}`}
          onClick={() => onSelect(subTabKey)}
        >
          {SUB_TAB_LABELS[subTabKey]}
        </UnderlineTab>
      ))}
    </UnderlineTabBar>
  )
}
