import {
  CalendarBlank,
  Eye,
  Gear,
  GridNine,
  Lightning,
  MathOperations,
  Table,
  Wrench,
  type Icon,
} from '@phosphor-icons/react'
import { useEffect, useRef, useState, useCallback } from 'react'
import type {
  SchemaInfoTab as SchemaInfoTabType,
  SchemaInfoResponse,
  ObjectType,
} from '../../types/schema'
import { openObjectDefaultTab } from '../../lib/object-activation'
import { getSchemaInfo } from '../../lib/schema-commands'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { ColumnsPanel } from './ColumnsPanel'
import { IndexesPanel } from './IndexesPanel'
import { ForeignKeysPanel } from './ForeignKeysPanel'
import { DdlPanel } from './DdlPanel'
import { StatsRow } from './StatsRow'
import { Button } from '../common/Button'
import { UnderlineTabBar, UnderlineTab } from '../common/UnderlineTabs'
import styles from './SchemaInfoTab.module.css'
import { toErrorMessage } from '../../lib/error-message'

export interface SchemaInfoTabProps {
  tab: SchemaInfoTabType
  isActive?: boolean
}

type SubTab = NonNullable<SchemaInfoTabType['subTabId']>

const SUB_TAB_VISIBILITY: Record<ObjectType, SubTab[]> = {
  table: ['columns', 'indexes', 'fks', 'ddl'],
  view: ['columns', 'ddl'],
  procedure: ['ddl'],
  function: ['ddl'],
  trigger: ['ddl'],
  event: ['ddl'],
}

const SUB_TAB_LABELS: Record<SubTab, string> = {
  columns: 'Columns',
  indexes: 'Indexes',
  fks: 'Foreign keys',
  ddl: 'DDL',
}

const OBJECT_TYPE_LABELS: Record<ObjectType, string> = {
  table: 'Table',
  view: 'View',
  procedure: 'Procedure',
  function: 'Function',
  trigger: 'Trigger',
  event: 'Event',
}

const TILE_ICONS: Record<ObjectType, Icon> = {
  table: Table,
  view: Eye,
  procedure: Gear,
  function: MathOperations,
  trigger: Lightning,
  event: CalendarBlank,
}

function getDefaultSubTab(objectType: ObjectType): SubTab {
  const tabs = SUB_TAB_VISIBILITY[objectType]
  return tabs.includes('columns') ? 'columns' : 'ddl'
}

const SUB_TAB_PANELS: Record<
  SubTab,
  (data: SchemaInfoResponse, objectType: ObjectType) => React.ReactNode
> = {
  columns: (data) => <ColumnsPanel columns={data.columns} />,
  indexes: (data) => <IndexesPanel indexes={data.indexes} />,
  fks: (data) => <ForeignKeysPanel foreignKeys={data.foreignKeys} />,
  ddl: (data, objectType) => (
    <DdlPanel ddl={data.ddl} metadata={data.metadata} objectType={objectType} />
  ),
}

const DATA_VIEWABLE_TYPES: ReadonlySet<ObjectType> = new Set<ObjectType>(['table', 'view'])

function SchemaInfoStatusView({
  stateClassName,
  textClassName,
  children,
}: {
  stateClassName: string
  textClassName: string
  children: React.ReactNode
}) {
  return (
    <div className={styles.container} data-testid="schema-info-tab">
      <div className={stateClassName}>
        <span className={textClassName}>{children}</span>
      </div>
    </div>
  )
}

interface SchemaInfoHeaderActionsProps {
  objectType: ObjectType
  onAlterTable: () => void
  onViewData: () => void
}

function SchemaInfoHeaderActions({
  objectType,
  onAlterTable,
  onViewData,
}: SchemaInfoHeaderActionsProps) {
  return (
    <>
      {objectType === 'table' ? (
        <Button size="sm" onClick={onAlterTable} data-testid="schema-info-alter-table">
          <Wrench size={16} weight="regular" />
          Alter table
        </Button>
      ) : null}
      {DATA_VIEWABLE_TYPES.has(objectType) ? (
        <Button size="sm" onClick={onViewData} data-testid="schema-info-view-data">
          <GridNine size={16} weight="regular" />
          View data
        </Button>
      ) : null}
    </>
  )
}

function useSchemaInfo(tab: SchemaInfoTabType, isActive: boolean) {
  const [data, setData] = useState<SchemaInfoResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadedKeyRef = useRef<string | null>(null)
  const requestKey = `${tab.connectionId}::${tab.databaseName}::${tab.objectName}::${tab.objectType}`

  useEffect(() => {
    let cancelled = false
    const alreadyLoadedCurrentObject =
      loadedKeyRef.current === requestKey && (data !== null || error !== null)

    if (!isActive) return
    if (alreadyLoadedCurrentObject) return

    queueMicrotask(() => {
      if (cancelled) {
        return
      }

      setLoading(true)
      setData(null)
      setError(null)
    })

    getSchemaInfo({
      connectionId: tab.connectionId,
      database: tab.databaseName,
      objectName: tab.objectName,
      objectType: tab.objectType,
    })
      .then((result) => {
        if (!cancelled) {
          loadedKeyRef.current = requestKey
          setData(result)
          setLoading(false)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          loadedKeyRef.current = requestKey
          setError(toErrorMessage(error))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    data,
    error,
    isActive,
    requestKey,
    tab.connectionId,
    tab.databaseName,
    tab.objectName,
    tab.objectType,
  ])

  return { data, loading, error }
}

function useSchemaInfoActions(tab: SchemaInfoTabType) {
  const handleAlterTable = useCallback(() => {
    useWorkspaceStore.getState().openTab({
      type: 'table-designer',
      mode: 'alter',
      connectionId: tab.connectionId,
      databaseName: tab.databaseName,
      objectName: tab.objectName,
      label: tab.objectName,
    })
  }, [tab.connectionId, tab.databaseName, tab.objectName])

  const handleViewData = useCallback(() => {
    openObjectDefaultTab({
      connectionId: tab.connectionId,
      database: tab.databaseName,
      objectType: tab.objectType,
      name: tab.objectName,
    })
  }, [tab.connectionId, tab.databaseName, tab.objectName, tab.objectType])

  return { handleAlterTable, handleViewData }
}

function SchemaInfoHeader({ tab }: { tab: SchemaInfoTabType }) {
  const actions = useSchemaInfoActions(tab)
  const TileIcon = TILE_ICONS[tab.objectType]
  return (
    <div className={styles.header} data-testid="schema-info-header">
      <span className={styles.tile} aria-hidden>
        <TileIcon size={16} weight="regular" />
      </span>
      <div className={styles.titleBlock}>
        <h1 className={styles.objectName}>{tab.objectName}</h1>
        <span className={styles.caption}>
          {OBJECT_TYPE_LABELS[tab.objectType]} · {tab.databaseName}
        </span>
      </div>
      <SchemaInfoHeaderActions
        objectType={tab.objectType}
        onAlterTable={actions.handleAlterTable}
        onViewData={actions.handleViewData}
      />
    </div>
  )
}

interface SchemaInfoSubTabBarProps {
  tab: SchemaInfoTabType
  activeSubTab: SubTab
}

function SchemaInfoSubTabBar({ tab, activeSubTab }: SchemaInfoSubTabBarProps) {
  const setSubTab = useWorkspaceStore((state) => state.setSubTab)
  return (
    <UnderlineTabBar rowHeight="tall" className={styles.subTabBar}>
      {SUB_TAB_VISIBILITY[tab.objectType].map((subTab) => (
        <UnderlineTab
          key={subTab}
          active={activeSubTab === subTab}
          onClick={() => setSubTab(tab.connectionId, tab.id, subTab)}
        >
          {SUB_TAB_LABELS[subTab]}
        </UnderlineTab>
      ))}
    </UnderlineTabBar>
  )
}

export function SchemaInfoTab({ tab, isActive = true }: SchemaInfoTabProps) {
  const { data, loading, error } = useSchemaInfo(tab, isActive)
  const activeSubTab = tab.subTabId ?? getDefaultSubTab(tab.objectType)

  if (loading) {
    return (
      <SchemaInfoStatusView stateClassName={styles.loadingState} textClassName={styles.loadingText}>
        Loading schema info...
      </SchemaInfoStatusView>
    )
  }

  if (error) {
    return (
      <SchemaInfoStatusView stateClassName={styles.errorState} textClassName={styles.errorText}>
        Failed to load schema info: {error}
      </SchemaInfoStatusView>
    )
  }

  if (!data) return null

  return (
    <div className={styles.container} data-testid="schema-info-tab">
      <SchemaInfoHeader tab={tab} />

      {tab.objectType === 'table' && data.metadata && (
        <StatsRow metadata={data.metadata} columnCount={data.columns.length} />
      )}

      <SchemaInfoSubTabBar tab={tab} activeSubTab={activeSubTab} />

      <div className={styles.subTabContent}>
        {SUB_TAB_PANELS[activeSubTab](data, tab.objectType)}
      </div>
    </div>
  )
}
