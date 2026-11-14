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
import styles from '../TableDesignerTab.module.css'
import { FIELD_CHROME } from '../../../lib/class-names-field'

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
    return <h1 className={styles.heading}>Alter table {tableName || objectName}</h1>
  }
  return (
    <>
      <h1 className={styles.heading}>Create table</h1>
      <TextInput
        variant="bare"
        type="text"
        value={tableName}
        placeholder="table_name"
        className={`${FIELD_CHROME} ${styles.tableNameInput}`}
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

interface DesignerContentProps {
  view: DesignerTabView
  subTab: SubTabContentProps
}

export function DesignerContent({ view, subTab }: DesignerContentProps) {
  if (view.loadError) {
    return (
      <div className={styles.errorState} data-testid="table-designer-error">
        {view.loadError}
      </div>
    )
  }

  if (view.isLoading) {
    return (
      <div className={styles.loadingState} data-testid="table-designer-loading">
        <div className={styles.spinner} aria-hidden />
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
    <div className={styles.header} data-testid="table-designer-header">
      <span className={styles.tile} aria-hidden>
        <Wrench size={16} weight="regular" />
      </span>
      <div className={styles.headingStack}>
        <DesignerHeading
          isCreateMode={view.mode === 'create'}
          tableName={view.tableName}
          objectName={header.objectName}
          onTableNameChange={header.onTableNameChange}
        />
        <span className={styles.caption} data-testid="table-designer-caption">
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
    <UnderlineTabBar className={styles.subTabBar} data-testid="table-designer-subtabs">
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
