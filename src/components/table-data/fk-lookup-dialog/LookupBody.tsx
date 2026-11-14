import { CanvasBaseGridView } from '../../shared/glide/CanvasBaseGridView'
import { Button } from '../../common/Button'
import type { GridColumnDescriptor, AutoSizeConfig } from '../../../types/shared-data-view'
import type { LookupRow, LookupSort } from './fk-lookup-model'
import styles from '../FkLookupDialog.module.css'

export interface LookupGridProps {
  rows: LookupRow[]
  columns: GridColumnDescriptor[]
  sort: LookupSort | null
  referencedColumn: string
  autoSizeConfig: AutoSizeConfig
  onSortChange: (column: string | null, direction: LookupSort['direction'] | null) => void
  onRowClick: (rowData: LookupRow) => void
  onRowDoubleClicked: (rowData: LookupRow) => void
  getRowClass: (rowData: LookupRow) => string | undefined
}

function LookupGrid({ grid }: { grid: LookupGridProps }) {
  return (
    <div className={styles.gridContainer}>
      <CanvasBaseGridView
        rows={grid.rows}
        columns={grid.columns}
        editState={null}
        sortColumn={grid.sort?.column ?? null}
        sortDirection={grid.sort?.direction ?? null}
        onSortChange={grid.onSortChange}
        onRowClick={grid.onRowClick}
        onRowDoubleClicked={grid.onRowDoubleClicked}
        getRowClass={grid.getRowClass}
        highlightColumnKey={grid.referencedColumn}
        autoSizeConfig={grid.autoSizeConfig}
        testId="fk-lookup-grid"
      />
    </div>
  )
}

interface LookupBodyProps {
  isLoading: boolean
  error: string | null
  onRetry: () => void
  grid: LookupGridProps
}

export function LookupBody({ isLoading, error, onRetry, grid }: LookupBodyProps) {
  if (isLoading) {
    return (
      <div className={styles.loadingContainer} data-testid="fk-lookup-loading">
        <span className={styles.spinner} />
        <span>Loading…</span>
      </div>
    )
  }

  if (error !== null) {
    return (
      <div className={styles.errorContainer} data-testid="fk-lookup-error">
        <span className={styles.errorMessage}>{error}</span>
        <Button onClick={onRetry} data-testid="fk-lookup-retry">
          Retry
        </Button>
      </div>
    )
  }

  const hasNoRows = grid.rows.length === 0
  if (hasNoRows) {
    return (
      <div className={styles.emptyContainer} data-testid="fk-lookup-empty">
        No rows found
      </div>
    )
  }

  return <LookupGrid grid={grid} />
}
