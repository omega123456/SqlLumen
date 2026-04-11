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
import { X, Funnel } from '@phosphor-icons/react'
import { DialogShell } from '../dialogs/DialogShell'
import { FilterDialog } from '../dialogs/FilterDialog'
import { BaseGridView } from '../shared/BaseGridView'
import { PaginationGroup } from '../shared/toolbar/PaginationGroup'
import { StatusArea } from '../shared/toolbar/StatusArea'
import { Button } from '../common/Button'
import { fetchTableData } from '../../lib/table-data-commands'
import { buildColumnDescriptors } from './table-data-grid-columns'
import type { TableDataColumnMeta, PrimaryKeyInfo, FilterCondition } from '../../types/schema'
import styles from './FkLookupDialog.module.css'

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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
  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------
  const [columns, setColumns] = useState<TableDataColumnMeta[]>([])
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [totalRows, setTotalRows] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [filterModel, setFilterModel] = useState<FilterCondition[]>([])
  const [sort, setSort] = useState<{ column: string; direction: 'ASC' | 'DESC' } | null>(null)
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
    async (
      page: number,
      size: number,
      filters: FilterCondition[],
      sortInfo: { column: string; direction: 'ASC' | 'DESC' } | null
    ) => {
      const thisToken = ++loadRequestTokenRef.current
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetchTableData({
          connectionId,
          database,
          table: referencedTable,
          page,
          pageSize: size,
          sortColumn: sortInfo?.column,
          sortDirection: sortInfo?.direction,
          filterModel: filters.length > 0 ? filters : undefined,
        })

        if (!mountedRef.current) return
        if (loadRequestTokenRef.current !== thisToken) return // stale response

        // Transform rows from unknown[][] to Record<string, unknown>[]
        const colNames = response.columns.map((c) => c.name)
        const transformedRows = response.rows.map((row, idx) => {
          const obj: Record<string, unknown> = { __rowIdx: idx }
          colNames.forEach((name, i) => {
            obj[name] = row[i] ?? null
          })
          return obj
        })

        setColumns(response.columns)
        setRows(transformedRows)
        setTotalRows(response.totalRows)
        setCurrentPage(response.currentPage)
        setTotalPages(response.totalPages)
        setPageSize(response.pageSize)
        setPrimaryKey(response.primaryKey)
        setExecutionTimeMs(response.executionTimeMs)
      } catch (err) {
        if (!mountedRef.current) return
        if (loadRequestTokenRef.current !== thisToken) return // stale error
        setError(err instanceof Error ? err.message : String(err))
        setRows([])
        setSelectedRowKey(null)
      } finally {
        if (mountedRef.current && loadRequestTokenRef.current === thisToken) {
          setIsLoading(false)
        }
      }
    },
    [connectionId, database, referencedTable]
  )

  // ---------------------------------------------------------------------------
  // Initial load on open (with optional pre-filter)
  // ---------------------------------------------------------------------------

  const hasInitialized = useRef(false)
  const prevParamsRef = useRef<string>('')
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

    // Determine initial filter
    const hasValue = currentValue !== null && currentValue !== undefined && currentValue !== ''

    const initialFilter: FilterCondition[] = hasValue
      ? [{ column: referencedColumn, operator: '==' as const, value: String(currentValue) }]
      : []

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
    prevParamsRef.current = JSON.stringify({
      filterModel: initialFilter,
      sort: initialSort,
      currentPage: initialPage,
      pageSize: initialPageSize,
    })

    // Suppress reload effect for this render cycle — it sees stale state
    suppressReloadRef.current = true

    void loadData(initialPage, initialPageSize, initialFilter, initialSort)
  }, [isOpen, currentValue, referencedColumn, loadData])

  // ---------------------------------------------------------------------------
  // Reload triggers (filter/sort/page/pageSize changes after initial load)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!isOpen || !hasInitialized.current) return

    // Skip if the initial load effect just fired in this same render cycle
    if (suppressReloadRef.current) {
      suppressReloadRef.current = false
      return
    }

    const paramsKey = JSON.stringify({ filterModel, sort, currentPage, pageSize })
    if (paramsKey === prevParamsRef.current) return
    prevParamsRef.current = paramsKey

    void loadData(currentPage, pageSize, filterModel, sort)
  }, [isOpen, filterModel, sort, currentPage, pageSize, loadData])

  // ---------------------------------------------------------------------------
  // Column descriptors for BaseGridView
  // ---------------------------------------------------------------------------

  const descriptorColumns = useMemo(() => buildColumnDescriptors(columns, true, false), [columns])

  // ---------------------------------------------------------------------------
  // Sort handler
  // ---------------------------------------------------------------------------

  const handleSortChange = useCallback(
    (column: string | null, direction: 'ASC' | 'DESC' | null) => {
      setSelectedRowKey(null)
      if (!column || !direction) {
        setSort(null)
      } else {
        setSort({ column, direction })
      }
    },
    []
  )

  // ---------------------------------------------------------------------------
  // Pagination handlers
  // ---------------------------------------------------------------------------

  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) {
      setSelectedRowKey(null)
      setCurrentPage((p) => p - 1)
    }
  }, [currentPage])

  const handleNextPage = useCallback(() => {
    if (currentPage < totalPages) {
      setSelectedRowKey(null)
      setCurrentPage((p) => p + 1)
    }
  }, [currentPage, totalPages])

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
    void loadData(currentPage, pageSize, filterModel, sort)
  }, [loadData, currentPage, pageSize, filterModel, sort])

  // ---------------------------------------------------------------------------
  // Row key computation
  // ---------------------------------------------------------------------------

  /** Compute a stable key for a row based on PK columns, or fall back to __rowIdx. */
  const computeRowKey = useCallback(
    (row: Record<string, unknown>) => {
      if (primaryKey && primaryKey.keyColumns.length > 0) {
        return JSON.stringify(primaryKey.keyColumns.map((col) => row[col]))
      }
      // Fallback: use the synthetic __rowIdx field added during row transformation
      return String(row['__rowIdx'] ?? -1)
    },
    [primaryKey]
  )

  /** Row key getter for BaseGridView (returns a string for RDG identity). */
  const rowKeyGetter = useCallback(
    (row: Record<string, unknown>) => {
      if (primaryKey?.keyColumns.length) {
        return JSON.stringify(primaryKey.keyColumns.map((c) => row[c]))
      }
      // Fallback: use the synthetic __rowIdx field
      return String(row['__rowIdx'] ?? -1)
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
      return computeRowKey(rowData) === selectedRowKey ? 'rdg-row-precision-selected' : undefined
    },
    [computeRowKey, selectedRowKey]
  )

  /** Apply the selected row's referenced column value. */
  const handleApply = useCallback(() => {
    if (selectedRowKey === null || isReadOnly) return
    const selectedRow = rows.find((row) => computeRowKey(row) === selectedRowKey)
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

    const isInteractiveElement = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false
      const tag = el.tagName.toLowerCase()
      return ['button', 'input', 'select', 'textarea', 'a'].includes(tag) || el.isContentEditable
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return
      if (isFilterDialogOpen) return
      if (isReadOnly) return
      if (selectedRowKey === null) return
      if (isInteractiveElement(e.target)) return
      e.preventDefault()
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

  // Determine grid content to show
  const showGrid = !isLoading && !error && rows.length > 0
  const showEmpty = !isLoading && !error && rows.length === 0
  const showLoading = isLoading
  const showError = !isLoading && error !== null

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
            <button
              type="button"
              className={styles.closeButton}
              onClick={onClose}
              aria-label="Close"
              data-testid="fk-lookup-close"
            >
              <X size={18} weight="bold" />
            </button>
          </div>

          {/* ── Toolbar ────────────────────────────────── */}
          <div className={styles.toolbar} data-testid="fk-lookup-toolbar">
            <div className={styles.toolbarLeft}>
              <StatusArea
                status={isLoading ? 'loading' : error !== null ? 'error' : 'success'}
                totalRows={totalRows}
                executionTimeMs={executionTimeMs > 0 ? executionTimeMs : undefined}
                errorMessage={error ?? undefined}
              />
            </div>

            <div className={styles.toolbarRight}>
              {/* Filter button */}
              <div
                className={`${styles.filterButtonWrapper} ${filterModel.length > 0 ? styles.filterButtonActive : ''}`}
              >
                <button
                  type="button"
                  className={styles.toolbarButton}
                  onClick={() => setIsFilterDialogOpen(true)}
                  disabled={columns.length === 0}
                  title="Filter"
                  data-testid="fk-lookup-btn-filter"
                >
                  <Funnel size={14} weight={filterModel.length > 0 ? 'fill' : 'regular'} />
                  <span>Filter</span>
                </button>
                {filterModel.length > 0 && (
                  <span className={styles.filterBadge} data-testid="fk-lookup-filter-badge">
                    {filterModel.length}
                  </span>
                )}
              </div>

              {/* Pagination */}
              <PaginationGroup
                currentPage={currentPage}
                totalPages={totalPages}
                pageSize={pageSize}
                disabled={isLoading}
                onPageSizeChange={handlePageSizeChange}
                onPrevPage={handlePrevPage}
                onNextPage={handleNextPage}
              />
            </div>
          </div>

          {/* ── Grid / Loading / Error / Empty ─────────── */}
          {showLoading && (
            <div className={styles.loadingContainer} data-testid="fk-lookup-loading">
              <span className={styles.spinner} />
              <span>Loading…</span>
            </div>
          )}

          {showError && (
            <div className={styles.errorContainer} data-testid="fk-lookup-error">
              <span className={styles.errorMessage}>{error}</span>
              <Button variant="secondary" onClick={handleRetry} data-testid="fk-lookup-retry">
                Retry
              </Button>
            </div>
          )}

          {showEmpty && (
            <div className={styles.emptyContainer} data-testid="fk-lookup-empty">
              No rows found
            </div>
          )}

          {showGrid && (
            <div className={styles.gridContainer} data-testid="fk-lookup-grid">
              <BaseGridView
                rows={rows}
                columns={descriptorColumns}
                editState={null}
                sortColumn={sort?.column ?? null}
                sortDirection={sort?.direction ?? null}
                onSortChange={handleSortChange}
                rowKeyGetter={rowKeyGetter}
                onRowClick={handleRowClick}
                onCellDoubleClick={handleCellDoubleClick}
                getRowClass={handleGetRowClass}
                highlightColumnKey={referencedColumn}
                testId="fk-lookup-base-grid"
              />
            </div>
          )}

          {/* ── Footer ─────────────────────────────────── */}
          <div className={styles.footer}>
            <Button variant="secondary" onClick={onClose} data-testid="fk-lookup-cancel">
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={selectedRowKey === null || isReadOnly || isLoading || !!error}
              onClick={handleApply}
              data-testid="fk-lookup-apply"
            >
              Apply
            </Button>
          </div>
        </div>
      </DialogShell>

      {/* ── Filter Dialog (sibling modal — outside DialogShell) ── */}
      <FilterDialog
        isOpen={isFilterDialogOpen}
        initialConditions={filterModel}
        columns={columns.map((c) => c.name)}
        onApply={handleFilterApply}
        onCancel={handleFilterCancel}
      />
    </>
  )
}
