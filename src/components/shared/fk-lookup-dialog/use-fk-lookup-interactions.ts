import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AutoSizeConfig, GridColumnDescriptor } from '../../../types/shared-data-view'
import { buildColumnDescriptors } from '../../table-data/table-data-grid-columns'
import { isInteractiveElement } from '../../../lib/input-events'
import type { LookupGridProps } from './LookupBody'
import type { FilterCondition, TableDataColumnMeta } from '../../../types/schema'
import {
  computeLookupColumnWidth,
  lookupRowKey,
  resolveLookupSort,
  type LookupRow,
  type LookupSort,
} from './fk-lookup-model'
import type { FkLookupData, LookupQuery } from './use-fk-lookup-data'

const SELECTED_LOOKUP_ROW_CLASS = 'glide-row-precision-selected'
const FIRST_PAGE = 1

function useLookupAutoSize(columns: TableDataColumnMeta[], rows: LookupRow[]): AutoSizeConfig {
  return useMemo(() => {
    const columnMetaByName = new Map(columns.map((column) => [column.name, column]))
    return {
      enabled: true,
      computeWidth: (column: GridColumnDescriptor) =>
        computeLookupColumnWidth(columnMetaByName, rows, column),
    }
  }, [columns, rows])
}

export function useLookupQueryHandlers(data: FkLookupData) {
  const { setQuery, setSelectedRowKey } = data
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
  const changeQuery = useCallback(
    (change: (query: LookupQuery) => LookupQuery) => {
      setSelectedRowKey(null)
      setQuery(change)
    },
    [setQuery, setSelectedRowKey]
  )
  const handleFilterApply = useCallback(
    (conditions: FilterCondition[]) => {
      setIsFilterDialogOpen(false)
      changeQuery((query) => ({ ...query, filterModel: conditions, currentPage: FIRST_PAGE }))
    },
    [changeQuery]
  )
  const currentPage = data.query.currentPage
  return {
    isFilterDialogOpen: isFilterDialogOpen,
    openFilterDialog: () => setIsFilterDialogOpen(true),
    closeFilterDialog: useCallback(() => setIsFilterDialogOpen(false), []),
    handleFilterApply: handleFilterApply,
    handleSortChange: useCallback(
      (column: string | null, direction: LookupSort['direction'] | null) =>
        changeQuery((query) => ({
          ...query,
          currentPage: FIRST_PAGE,
          sort: resolveLookupSort(column, direction),
        })),
      [changeQuery]
    ),
    paging: {
      onPrevPage: useCallback(() => {
        if (currentPage <= FIRST_PAGE) return
        changeQuery((query) => ({ ...query, currentPage: query.currentPage - 1 }))
      }, [currentPage, changeQuery]),
      onNextPage: useCallback(
        () => changeQuery((query) => ({ ...query, currentPage: query.currentPage + 1 })),
        [changeQuery]
      ),
      onPageSizeChange: useCallback(
        (newSize: number) =>
          changeQuery((query) => ({ ...query, pageSize: newSize, currentPage: FIRST_PAGE })),
        [changeQuery]
      ),
      onPageSubmit: (page: number) => changeQuery((query) => ({ ...query, currentPage: page })),
    },
  }
}

export interface LookupApplyInputs {
  data: FkLookupData
  isReadOnly: boolean
  referencedColumn: string
  onApply: (value: unknown) => void
  onClose: () => void
}

function useLookupRowSelection({
  data,
  isReadOnly,
  referencedColumn,
  onApply,
  onClose,
}: LookupApplyInputs) {
  const { primaryKey, rows } = data.page
  const { selectedRowKey, setSelectedRowKey } = data
  const computeRowKey = useCallback((row: LookupRow) => lookupRowKey(row, primaryKey), [primaryKey])
  const applyRow = useCallback(
    (row: LookupRow) => {
      onApply(row[referencedColumn])
      onClose()
    },
    [referencedColumn, onApply, onClose]
  )
  const handleApply = useCallback(() => {
    if (selectedRowKey === null) return
    if (isReadOnly) return
    const selectedRow = rows.find((row) => computeRowKey(row) === selectedRowKey)
    if (!selectedRow) return
    applyRow(selectedRow)
  }, [selectedRowKey, isReadOnly, rows, computeRowKey, applyRow])
  return {
    handleApply: handleApply,
    handleRowClick: useCallback(
      (row: LookupRow) => setSelectedRowKey(computeRowKey(row)),
      [computeRowKey, setSelectedRowKey]
    ),
    handleRowDoubleClick: useCallback(
      (row: LookupRow) => {
        if (isReadOnly) return
        applyRow(row)
      },
      [isReadOnly, applyRow]
    ),
    getRowClass: useCallback(
      (row: LookupRow) => {
        const isSelectedRow = computeRowKey(row) === selectedRowKey
        return isSelectedRow ? SELECTED_LOOKUP_ROW_CLASS : undefined
      },
      [computeRowKey, selectedRowKey]
    ),
  }
}

interface EnterToApplyInputs {
  isOpen: boolean
  isFilterDialogOpen: boolean
  isReadOnly: boolean
  selectedRowKey: string | null
  handleApply: () => void
}

function useEnterToApply(inputs: EnterToApplyInputs) {
  const { isOpen, isFilterDialogOpen, isReadOnly, selectedRowKey, handleApply } = inputs
  useEffect(() => {
    if (!isOpen) return
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
}

export function useLookupSelection(
  inputs: LookupApplyInputs,
  dialog: { isOpen: boolean; isFilterDialogOpen: boolean }
) {
  const selection = useLookupRowSelection(inputs)
  useEnterToApply({
    isOpen: dialog.isOpen,
    isFilterDialogOpen: dialog.isFilterDialogOpen,
    isReadOnly: inputs.isReadOnly,
    selectedRowKey: inputs.data.selectedRowKey,
    handleApply: selection.handleApply,
  })
  return selection
}

interface LookupGridInputs {
  data: FkLookupData
  referencedColumn: string
  queryHandlers: ReturnType<typeof useLookupQueryHandlers>
  selection: ReturnType<typeof useLookupSelection>
}

export function useLookupGridProps(inputs: LookupGridInputs): LookupGridProps {
  const { data, queryHandlers, selection } = inputs
  const { columns, rows } = data.page
  const descriptorColumns = useMemo(
    () => buildColumnDescriptors({ columns: columns, isReadOnly: true, hasPrimaryKey: false }),
    [columns]
  )
  return {
    rows: rows,
    columns: descriptorColumns,
    sort: data.query.sort,
    referencedColumn: inputs.referencedColumn,
    autoSizeConfig: useLookupAutoSize(columns, rows),
    onSortChange: queryHandlers.handleSortChange,
    onRowClick: selection.handleRowClick,
    onRowDoubleClicked: selection.handleRowDoubleClick,
    getRowClass: selection.getRowClass,
  }
}
