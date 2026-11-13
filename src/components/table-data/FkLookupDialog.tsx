/**
 * FkLookupDialog — modal dialog for looking up values from a referenced (FK) table.
 *
 * Displays the referenced table's data in a read-only grid with filtering,
 * sorting, and pagination. The user can browse the referenced table to find
 * the value they want to assign to the FK column.
 *
 * Phase 6A: skeleton, data loading, grid display, filter, sort, pagination.
 * Phase 6B: row selection, Apply/double-click/Enter integration.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { X } from '@phosphor-icons/react'
import { DialogShell } from '../dialogs/DialogShell'
import { FilterDialog } from '../dialogs/FilterDialog'
import { CanvasBaseGridView } from '../shared/glide/CanvasBaseGridView'
import { FilterToolbarButton } from '../shared/FilterToolbarButton'
import { PaginationGroup } from '../shared/toolbar/PaginationGroup'
import { StatusArea } from '../shared/toolbar/StatusArea'
import { Button } from '../common/Button'
import { evictTableData, fetchTableData } from '../../lib/table-data-commands'
import { buildColumnDescriptors } from './table-data-grid-columns'
import {
  AUTO_SIZE_SAMPLE_LIMIT,
  DEFAULT_COLUMN_WIDTH_PX,
  HEADER_ICON_WIDTH_PX,
  getAutoSizedColumnWidth,
} from '../../lib/grid-column-style'
import type { GridColumnDescriptor, AutoSizeConfig, StatusType } from '../../types/shared-data-view'
import type {
  TableDataColumnMeta,
  TableDataResponse,
  PrimaryKeyInfo,
  FilterCondition,
} from '../../types/schema'
import { logFrontend } from '../../lib/app-log-commands'
import styles from './FkLookupDialog.module.css'
import { toErrorMessage } from '../../lib/error-message'

const LOOKUP_PAGE_SIZE = 100

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FkLookupDialogProps {
  isOpen: boolean
  onClose: () => void
  onApply: (value: unknown) => void
  connectionId: string
  database: string
  sourceTable: string
  sourceColumn: string
  currentValue: unknown
  referencedTable: string
  referencedColumn: string
  isReadOnly: boolean
}

interface LookupSort {
  column: string
  direction: 'ASC' | 'DESC'
}

type LookupRow = Record<string, unknown>

function lookupSortRequest(sortInfo: LookupSort | null) {
  if (!sortInfo) return { sortColumn: undefined, sortDirection: undefined }
  return { sortColumn: sortInfo.column, sortDirection: sortInfo.direction.toLowerCase() }
}

function toLookupRows(response: TableDataResponse): LookupRow[] {
  const columnNames = response.columns.map((column) => column.name)
  return response.rows.map((row, index) => {
    const lookupRow: LookupRow = { __rowIdx: index }
    columnNames.forEach((name, columnIndex) => {
      lookupRow[name] = row[columnIndex] ?? null
    })
    return lookupRow
  })
}

function hasLookupValue(currentValue: unknown): boolean {
  return currentValue !== null && currentValue !== undefined && currentValue !== ''
}

function initialLookupFilter(currentValue: unknown, referencedColumn: string): FilterCondition[] {
  if (!hasLookupValue(currentValue)) return []
  return [{ column: referencedColumn, operator: '==' as const, value: String(currentValue) }]
}

function resolveLookupSort(
  column: string | null,
  direction: LookupSort['direction'] | null
): LookupSort | null {
  if (!column) return null
  if (!direction) return null
  return { column, direction }
}

function lookupRowKey(row: LookupRow, primaryKey: PrimaryKeyInfo | null): string {
  const keyColumns = primaryKey?.keyColumns ?? []
  if (keyColumns.length > 0) {
    return JSON.stringify(keyColumns.map((column) => row[column]))
  }
  // Fallback: use the synthetic __rowIdx field added during row transformation
  return String(row['__rowIdx'] ?? -1)
}

function lookupStatus(isLoading: boolean, error: string | null): StatusType {
  if (isLoading) return 'loading'
  if (error !== null) return 'error'
  return 'success'
}

interface ApplyAvailability {
  hasSelection: boolean
  isReadOnly: boolean
  isLoading: boolean
  error: string | null
}

function isApplyEnabled(availability: ApplyAvailability): boolean {
  if (!availability.hasSelection) return false
  if (availability.isReadOnly) return false
  return !availability.isLoading && !availability.error
}

interface LookupGridProps {
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

function LookupBody({ isLoading, error, onRetry, grid }: LookupBodyProps) {
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface LookupPageRequest {
  page: number
  size: number
  filters: FilterCondition[]
  sortInfo: LookupSort | null
}

export function FkLookupDialog({
  isOpen,
  onClose,
  onApply,
  connectionId,
  database,
  sourceTable,
  sourceColumn,
  currentValue,
  referencedTable,
  referencedColumn,
  isReadOnly,
}: FkLookupDialogProps) {
  const cacheTabId = `fk-lookup-${connectionId}-${database}-${referencedTable}`

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------
  const [columns, setColumns] = useState<TableDataColumnMeta[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(LOOKUP_PAGE_SIZE)
  const [filterModel, setFilterModel] = useState<FilterCondition[]>([])
  const [sort, setSort] = useState<LookupSort | null>(null)
  const [primaryKey, setPrimaryKey] = useState<PrimaryKeyInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [executionTimeMs, setExecutionTimeMs] = useState<number>(0)
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null)

  // Track if mounted to avoid state updates after unmount
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Monotonically increasing request token to guard against stale async responses
  const loadRequestTokenRef = useRef(0)

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadData = useCallback(
    async ({ page, size, filters, sortInfo }: LookupPageRequest) => {
      const thisToken = ++loadRequestTokenRef.current
      const isCurrentRequest = () => mountedRef.current && loadRequestTokenRef.current === thisToken
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetchTableData({
          connectionId: connectionId,
          tabId: cacheTabId,
          database: database,
          table: referencedTable,
          page: page,
          pageSize: size,
          ...lookupSortRequest(sortInfo),
          filterModel: filters.length > 0 ? filters : undefined,
        })

        if (!isCurrentRequest()) return

        setColumns(response.columns)
        setRows(toLookupRows(response))
        setCurrentPage(response.currentPage)
        setPageSize(response.pageSize)
        setPrimaryKey(response.primaryKey)
        setExecutionTimeMs(response.executionTimeMs)
      } catch (error) {
        if (!isCurrentRequest()) return
        setError(toErrorMessage(error))
        setRows([])
        setSelectedRowKey(null)
      } finally {
        if (isCurrentRequest()) {
          setIsLoading(false)
        }
      }
    },
    [cacheTabId, connectionId, database, referencedTable]
  )

  useEffect(() => {
    if (!isOpen) {
      return
    }

    return () => {
      evictTableData({
        connectionId: connectionId,
        tabId: cacheTabId,
      }).catch((error: unknown) => {
        const errorMessage = toErrorMessage(error)
        logFrontend('warn', `FK lookup cache cleanup failed for ${cacheTabId}: ${errorMessage}`)
      })
    }
  }, [cacheTabId, connectionId, isOpen])

  // ---------------------------------------------------------------------------
  // Initial load on open (with optional pre-filter)
  // ---------------------------------------------------------------------------

  const hasInitialized = useRef(false)
  const previousParamsRef = useRef<string>('')
  // Suppress the reload effect from firing in the same render cycle as the
  // initial load. The initial load sets new state values (e.g. filterModel)
  // but the reload effect in the same render still sees stale state, causing
  // it to mismatch prevParamsRef and fire a duplicate request.
  const suppressReloadRef = useRef(false)

  useEffect(() => {
    if (!isOpen) {
      // Reset on close
      hasInitialized.current = false
      return
    }

    if (hasInitialized.current) return
    hasInitialized.current = true

    const initialFilter = initialLookupFilter(currentValue, referencedColumn)

    const initialPage = 1
    const initialPageSize = 100
    const initialSort = null

    setFilterModel(initialFilter)
    setCurrentPage(initialPage)
    setSort(initialSort)
    setPageSize(initialPageSize)
    setError(null)
    setRows([])
    setColumns([])

    // Pre-seed prevParamsRef so the reload effect doesn't double-fire
    previousParamsRef.current = JSON.stringify({
      filterModel: initialFilter,
      sort: initialSort,
      currentPage: initialPage,
      pageSize: initialPageSize,
    })

    // Suppress reload effect for this render cycle — it sees stale state
    suppressReloadRef.current = true

    void loadData({
      page: initialPage,
      size: initialPageSize,
      filters: initialFilter,
      sortInfo: initialSort,
    })
  }, [isOpen, currentValue, referencedColumn, loadData])

  // ---------------------------------------------------------------------------
  // Reload triggers (filter/sort/page/pageSize changes after initial load)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!isOpen) return
    if (!hasInitialized.current) return

    // Skip if the initial load effect just fired in this same render cycle
    if (suppressReloadRef.current) {
      suppressReloadRef.current = false
      return
    }

    const paramsKey = JSON.stringify({ filterModel, sort, currentPage, pageSize })
    if (paramsKey === previousParamsRef.current) return
    previousParamsRef.current = paramsKey

    void loadData({ page: currentPage, size: pageSize, filters: filterModel, sortInfo: sort })
  }, [isOpen, filterModel, sort, currentPage, pageSize, loadData])

  // ---------------------------------------------------------------------------
  // Column descriptors for BaseGridView
  // ---------------------------------------------------------------------------

  const descriptorColumns = useMemo(
    () => buildColumnDescriptors({ columns: columns, isReadOnly: true, hasPrimaryKey: false }),
    [columns]
  )

  // Auto-size columns to fit header/data, mirroring TableDataGrid. Rows here are
  // keyed by column name, so the single-column proxy extracts row[col.key].
  const autoSizeConfig: AutoSizeConfig = useMemo(() => {
    const columnMetaByName = new Map<string, TableDataColumnMeta>()
    for (const column of columns) columnMetaByName.set(column.name, column)

    return {
      enabled: true,
      computeWidth: (column: GridColumnDescriptor) => {
        const meta = columnMetaByName.get(column.key)
        if (!meta) return DEFAULT_COLUMN_WIDTH_PX
        const sampleCount = Math.min(rows.length, AUTO_SIZE_SAMPLE_LIMIT)
        const columnRows: unknown[][] = new Array(sampleCount)
        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
          columnRows[sampleIndex] = [rows[sampleIndex][column.key]]
        }
        const showsHeaderIcon = Boolean(column.foreignKey) || !column.editable
        const headerIconWidthPx = showsHeaderIcon ? HEADER_ICON_WIDTH_PX : 0
        return getAutoSizedColumnWidth({
          column: meta,
          columnIndex: 0,
          rows: columnRows,
          displayName: column.key,
          headerIconWidthPx: headerIconWidthPx,
        })
      },
    }
  }, [columns, rows])

  // ---------------------------------------------------------------------------
  // Sort handler
  // ---------------------------------------------------------------------------

  const handleSortChange = useCallback(
    (column: string | null, direction: 'ASC' | 'DESC' | null) => {
      setSelectedRowKey(null)
      setCurrentPage(1)
      setSort(resolveLookupSort(column, direction))
    },
    []
  )

  // ---------------------------------------------------------------------------
  // Pagination handlers
  // ---------------------------------------------------------------------------

  const handlePreviousPage = useCallback(() => {
    if (currentPage > 1) {
      setSelectedRowKey(null)
      setCurrentPage((currentPage) => currentPage - 1)
    }
  }, [currentPage])

  const handleNextPage = useCallback(() => {
    setSelectedRowKey(null)
    setCurrentPage((currentPage) => currentPage + 1)
  }, [])

  const handlePageSizeChange = useCallback((newSize: number) => {
    setSelectedRowKey(null)
    setPageSize(newSize)
    setCurrentPage(1)
  }, [])

  // ---------------------------------------------------------------------------
  // Filter handlers
  // ---------------------------------------------------------------------------

  const handleFilterApply = useCallback((conditions: FilterCondition[]) => {
    setIsFilterDialogOpen(false)
    setSelectedRowKey(null)
    setFilterModel(conditions)
    setCurrentPage(1)
  }, [])

  const handleFilterCancel = useCallback(() => {
    setIsFilterDialogOpen(false)
  }, [])

  // ---------------------------------------------------------------------------
  // Retry handler
  // ---------------------------------------------------------------------------

  const handleRetry = useCallback(() => {
    void loadData({ page: currentPage, size: pageSize, filters: filterModel, sortInfo: sort })
  }, [loadData, currentPage, pageSize, filterModel, sort])

  // ---------------------------------------------------------------------------
  // Row key computation
  // ---------------------------------------------------------------------------

  /** Compute a stable key for a row based on PK columns, or fall back to __rowIdx. */
  const computeRowKey = useCallback(
    (row: Record<string, unknown>) => {
      return lookupRowKey(row, primaryKey)
    },
    [primaryKey]
  )

  // ---------------------------------------------------------------------------
  // Row selection and Apply logic (Phase 6B)
  // ---------------------------------------------------------------------------

  /** Handle row click — select the clicked row. */
  const handleRowClick = useCallback(
    (rowData: Record<string, unknown>) => {
      setSelectedRowKey(computeRowKey(rowData))
    },
    [computeRowKey]
  )

  /** Handle double-click — select and immediately apply (no-op when read-only). */
  const handleCellDoubleClick = useCallback(
    (rowData: Record<string, unknown>) => {
      if (isReadOnly) return
      const value = rowData[referencedColumn]
      onApply(value)
      onClose()
    },
    [isReadOnly, referencedColumn, onApply, onClose]
  )

  /** Get row class — highlight the selected row. */
  const handleGetRowClass = useCallback(
    (rowData: Record<string, unknown>) => {
      const isSelectedRow = computeRowKey(rowData) === selectedRowKey
      return isSelectedRow ? 'glide-row-precision-selected' : undefined
    },
    [computeRowKey, selectedRowKey]
  )

  /** Apply the selected row's referenced column value. */
  const handleApply = useCallback(() => {
    if (selectedRowKey === null) return
    if (isReadOnly) return
    const isSelectedRow = (row: LookupRow): boolean => computeRowKey(row) === selectedRowKey
    const selectedRow = rows.find(isSelectedRow)
    if (!selectedRow) return
    const value = selectedRow[referencedColumn]
    onApply(value)
    onClose()
  }, [selectedRowKey, isReadOnly, rows, computeRowKey, referencedColumn, onApply, onClose])

  // ---------------------------------------------------------------------------
  // Enter key handler — applies when a row is selected and not read-only
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!isOpen) return

    const isInteractiveElement = (element: EventTarget | null): boolean => {
      if (!(element instanceof HTMLElement)) return false
      const tag = element.tagName.toLowerCase()
      return (
        ['button', 'input', 'select', 'textarea', 'a'].includes(tag) || element.isContentEditable
      )
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter') return
      if (isFilterDialogOpen) return
      if (isReadOnly) return
      if (selectedRowKey === null) return
      if (isInteractiveElement(event.target)) return
      event.preventDefault()
      handleApply()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, isFilterDialogOpen, isReadOnly, selectedRowKey, handleApply])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const canApplySelection = isApplyEnabled({
    hasSelection: selectedRowKey !== null,
    isReadOnly: isReadOnly,
    isLoading: isLoading,
    error: error,
  })

  return (
    <>
      <DialogShell
        isOpen={isOpen}
        onClose={onClose}
        panelWidth="80vw"
        panelPadding={false}
        testId="fk-lookup-dialog"
        ariaLabel="Foreign key lookup"
        nonDismissible={isFilterDialogOpen}
      >
        <div className={styles.dialogContent} data-testid="fk-lookup-dialog-content">
          {/* ── Header ─────────────────────────────────── */}
          <div className={styles.header}>
            <div className={styles.headerText}>
              <h2 className={styles.title} data-testid="fk-lookup-title">
                Look Up — {referencedTable}.{referencedColumn}
              </h2>
              <p className={styles.subtitle} data-testid="fk-lookup-subtitle">
                {sourceTable}.{sourceColumn} → {referencedTable}.{referencedColumn}
              </p>
            </div>
            <Button
              variant="bare"
              className={styles.closeButton}
              onClick={onClose}
              aria-label="Close"
              data-testid="fk-lookup-close"
            >
              <X size={18} weight="bold" />
            </Button>
          </div>

          {/* ── Toolbar ────────────────────────────────── */}
          <div className={styles.toolbar} data-testid="fk-lookup-toolbar">
            <div className={styles.toolbarLeft}>
              <StatusArea
                status={lookupStatus(isLoading, error)}
                executionTimeMs={executionTimeMs > 0 ? executionTimeMs : undefined}
                errorMessage={error ?? undefined}
              />
            </div>

            <div className={styles.toolbarRight}>
              <FilterToolbarButton
                isActive={filterModel.length > 0}
                activeCount={filterModel.length}
                onFilterClick={() => setIsFilterDialogOpen(true)}
                onClearClick={() => handleFilterApply([])}
                isDisabled={columns.length === 0}
                filterButtonTestId="fk-lookup-btn-filter"
                filterBadgeTestId="fk-lookup-filter-badge"
                clearButtonTestId="fk-lookup-btn-clear-filter"
              />

              {/* Pagination */}
              <PaginationGroup
                currentPage={currentPage}
                paginationMode="unknown"
                pageSize={pageSize}
                disabled={isLoading}
                onPageSizeChange={handlePageSizeChange}
                onPageSubmit={(page) => {
                  setSelectedRowKey(null)
                  setCurrentPage(page)
                }}
                onPrevPage={handlePreviousPage}
                onNextPage={handleNextPage}
              />
            </div>
          </div>

          {/* ── Grid / Loading / Error / Empty ─────────── */}
          <LookupBody
            isLoading={isLoading}
            error={error}
            onRetry={handleRetry}
            grid={{
              rows: rows,
              columns: descriptorColumns,
              sort: sort,
              referencedColumn: referencedColumn,
              autoSizeConfig: autoSizeConfig,
              onSortChange: handleSortChange,
              onRowClick: handleRowClick,
              onRowDoubleClicked: handleCellDoubleClick,
              getRowClass: handleGetRowClass,
            }}
          />

          {/* ── Footer ─────────────────────────────────── */}
          <div className={styles.footer}>
            <Button
              variant="accent"
              disabled={!canApplySelection}
              onClick={handleApply}
              data-testid="fk-lookup-apply"
            >
              Apply
            </Button>
            <Button onClick={onClose} data-testid="fk-lookup-cancel">
              Cancel
            </Button>
          </div>
        </div>
      </DialogShell>

      {/* ── Filter Dialog (sibling modal — outside DialogShell) ── */}
      <FilterDialog
        isOpen={isFilterDialogOpen}
        initialConditions={filterModel}
        columns={columns.map((column) => column.name)}
        onApply={handleFilterApply}
        onCancel={handleFilterCancel}
      />
    </>
  )
}
