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

export interface SchemaInfoTabProps {
  tab: SchemaInfoTabType
  isActive?: boolean
}

type SubTab = NonNullable<SchemaInfoTabType['subTabId']>

/** Which sub-tabs are visible per object type. */
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

export function SchemaInfoTab({ tab, isActive = true }: SchemaInfoTabProps) {
  const [data, setData] = useState<SchemaInfoResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadedKeyRef = useRef<string | null>(null)
  const setSubTab = useWorkspaceStore((state) => state.setSubTab)

  const visibleSubTabs = SUB_TAB_VISIBILITY[tab.objectType]
  const activeSubTab = tab.subTabId ?? getDefaultSubTab(tab.objectType)
  const requestKey = `${tab.connectionId}::${tab.databaseName}::${tab.objectName}::${tab.objectType}`

  useEffect(() => {
    let cancelled = false
    const alreadyLoadedCurrentObject =
      loadedKeyRef.current === requestKey && (data !== null || error !== null)

    if (!isActive || alreadyLoadedCurrentObject) return

    // Clear stale state immediately before fetching new data
    queueMicrotask(() => {
      if (cancelled) {
        return
      }

      setLoading(true)
      setData(null)
      setError(null)
    })

    getSchemaInfo(tab.connectionId, tab.databaseName, tab.objectName, tab.objectType)
      .then((result) => {
        if (!cancelled) {
          loadedKeyRef.current = requestKey
          setData(result)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          loadedKeyRef.current = requestKey
          setError(err instanceof Error ? err.message : String(err))
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

  const handleSubTabClick = useCallback(
    (subTab: SubTab) => {
      setSubTab(tab.connectionId, tab.id, subTab)
    },
    [setSubTab, tab.connectionId, tab.id]
  )

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
    openObjectDefaultTab(tab.connectionId, tab.databaseName, tab.objectType, tab.objectName)
  }, [tab.connectionId, tab.databaseName, tab.objectName, tab.objectType])

  const TileIcon = TILE_ICONS[tab.objectType]

  if (loading) {
    return (
      <div className={styles.container} data-testid="schema-info-tab">
        <div className={styles.loadingState}>
          <span className={styles.loadingText}>Loading schema info...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.container} data-testid="schema-info-tab">
        <div className={styles.errorState}>
          <span className={styles.errorText}>Failed to load schema info: {error}</span>
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className={styles.container} data-testid="schema-info-tab">
      {/* Page header (prototype `.vh`): icon tile, name, "<Type> · <database>" caption */}
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
        {tab.objectType === 'table' ? (
          <Button size="sm" onClick={handleAlterTable} data-testid="schema-info-alter-table">
            <Wrench size={16} weight="regular" />
            Alter table
          </Button>
        ) : null}
        {tab.objectType === 'table' || tab.objectType === 'view' ? (
          <Button size="sm" onClick={handleViewData} data-testid="schema-info-view-data">
            <GridNine size={16} weight="regular" />
            View data
          </Button>
        ) : null}
      </div>

      {/* Stats row (tables only); column count shown on every sub-tab */}
      {tab.objectType === 'table' && data.metadata && (
        <StatsRow metadata={data.metadata} columnCount={data.columns.length} />
      )}

      {/* Sub-tab navigation */}
      <UnderlineTabBar className={styles.subTabBar}>
        {visibleSubTabs.map((st) => (
          <UnderlineTab key={st} active={activeSubTab === st} onClick={() => handleSubTabClick(st)}>
            {SUB_TAB_LABELS[st]}
          </UnderlineTab>
        ))}
      </UnderlineTabBar>

      {/* Sub-tab content */}
      <div className={styles.subTabContent}>
        {activeSubTab === 'columns' && <ColumnsPanel columns={data.columns} />}
        {activeSubTab === 'indexes' && <IndexesPanel indexes={data.indexes} />}
        {activeSubTab === 'fks' && <ForeignKeysPanel foreignKeys={data.foreignKeys} />}
        {activeSubTab === 'ddl' && (
          <DdlPanel ddl={data.ddl} metadata={data.metadata} objectType={tab.objectType} />
        )}
      </div>
    </div>
  )
}
