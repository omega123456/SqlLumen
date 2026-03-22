import { useEffect, useState, useCallback } from 'react'
import type { WorkspaceTab, SchemaInfoResponse, ObjectType } from '../../types/schema'
import { getSchemaInfo } from '../../lib/schema-commands'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { ColumnsPanel } from './ColumnsPanel'
import { IndexesPanel } from './IndexesPanel'
import { ForeignKeysPanel } from './ForeignKeysPanel'
import { DdlPanel } from './DdlPanel'
import { StatsRow } from './StatsRow'
import styles from './SchemaInfoTab.module.css'

export interface SchemaInfoTabProps {
  tab: WorkspaceTab
}

type SubTab = NonNullable<WorkspaceTab['subTabId']>

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
  fks: 'Foreign Keys',
  ddl: 'DDL',
}

function getDefaultSubTab(objectType: ObjectType): SubTab {
  const tabs = SUB_TAB_VISIBILITY[objectType]
  return tabs.includes('columns') ? 'columns' : 'ddl'
}

export function SchemaInfoTab({ tab }: SchemaInfoTabProps) {
  const [data, setData] = useState<SchemaInfoResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const setSubTab = useWorkspaceStore((state) => state.setSubTab)

  const visibleSubTabs = SUB_TAB_VISIBILITY[tab.objectType]
  const activeSubTab = tab.subTabId ?? getDefaultSubTab(tab.objectType)

  useEffect(() => {
    let cancelled = false

    // Clear stale state immediately before fetching new data
    setLoading(true)
    setData(null)
    setError(null)

    getSchemaInfo(tab.connectionId, tab.databaseName, tab.objectName, tab.objectType)
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [tab.connectionId, tab.databaseName, tab.objectName, tab.objectType])

  const handleSubTabClick = useCallback(
    (subTab: SubTab) => {
      setSubTab(tab.connectionId, tab.id, subTab)
    },
    [setSubTab, tab.connectionId, tab.id]
  )

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
      {/* Header row */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.objectTypeLabel}>{tab.objectType.toUpperCase()}</span>
          <span className={styles.objectName}>
            {tab.databaseName}.{tab.objectName}
          </span>
        </div>
      </div>

      {/* Stats row (tables only); column count on Columns sub-tab only */}
      {tab.objectType === 'table' && data.metadata && (
        <StatsRow
          metadata={data.metadata}
          columnCount={activeSubTab === 'columns' ? data.columns.length : undefined}
        />
      )}

      {/* Sub-tab navigation */}
      <div className={styles.subTabBar}>
        {visibleSubTabs.map((st) => (
          <button
            key={st}
            type="button"
            className={`${styles.subTab} ${activeSubTab === st ? styles.subTabActive : ''}`}
            onClick={() => handleSubTabClick(st)}
          >
            {SUB_TAB_LABELS[st]}
          </button>
        ))}
      </div>

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
