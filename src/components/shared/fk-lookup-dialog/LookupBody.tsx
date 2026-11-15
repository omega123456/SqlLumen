import { CanvasBaseGridView } from '../glide/CanvasBaseGridView'
import { Button } from '../../common/Button'
import type { GridColumnDescriptor, AutoSizeConfig } from '../../../types/shared-data-view'
import type { LookupRow, LookupSort } from './fk-lookup-model'

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
    <div className="min-h-0 flex-1 overflow-hidden">
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
      <div
        className="flex flex-1 items-center justify-center gap-2 text-light-on-surface-variant dark:text-dark-on-surface-variant"
        data-testid="fk-lookup-loading"
      >
        <span className="inline-block size-4 animate-spin-600ms rounded-round border-2 border-light-stroke-card border-t-light-on-surface-variant window-blurred:animate-spin-600ms-paused dark:border-dark-stroke-card dark:border-t-dark-on-surface-variant" />
        <span>Loading…</span>
      </div>
    )
  }

  if (error !== null) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 text-light-error dark:text-dark-error"
        data-testid="fk-lookup-error"
      >
        <span className="max-w-100 text-center text-size-row">{error}</span>
        <Button onClick={onRetry} data-testid="fk-lookup-retry">
          Retry
        </Button>
      </div>
    )
  }

  const hasNoRows = grid.rows.length === 0
  if (hasNoRows) {
    return (
      <div
        className="flex flex-1 items-center justify-center text-size-row text-light-on-surface-variant dark:text-dark-on-surface-variant"
        data-testid="fk-lookup-empty"
      >
        No rows found
      </div>
    )
  }

  return <LookupGrid grid={grid} />
}
