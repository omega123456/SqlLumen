import { Link, Trash } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { listColumns, listSchemaObjects } from '../../lib/schema-commands'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import { Button } from '../common/Button'
import styles from './ForeignKeyEditor.module.css'

interface ForeignKeyEditorProps {
  tabId: string
}

const ACTION_OPTIONS = ['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT']

export function ForeignKeyEditor({ tabId }: ForeignKeyEditorProps) {
  const tabState = useTableDesignerStore((state) => state.tabs[tabId])
  const addForeignKey = useTableDesignerStore((state) => state.addForeignKey)
  const deleteForeignKey = useTableDesignerStore((state) => state.deleteForeignKey)
  const updateForeignKey = useTableDesignerStore((state) => state.updateForeignKey)

  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [referencedTables, setReferencedTables] = useState<string[]>([])
  const [isTablesLoading, setIsTablesLoading] = useState(false)
  const [referencedColumnsByTable, setReferencedColumnsByTable] = useState<
    Record<string, string[]>
  >({})
  const [loadingColumnsByTable, setLoadingColumnsByTable] = useState<Record<string, boolean>>({})

  const loadedTableColumnsRef = useRef<Set<string>>(new Set())
  const loadingTableColumnsRef = useRef<Set<string>>(new Set())

  const columns = useMemo(
    () => tabState?.currentSchema.columns ?? [],
    [tabState?.currentSchema.columns]
  )
  const foreignKeys = useMemo(
    () => tabState?.currentSchema.foreignKeys ?? [],
    [tabState?.currentSchema.foreignKeys]
  )
  const connectionId = tabState?.connectionId
  const databaseName = tabState?.databaseName
  const columnNames = useMemo(
    () => columns.map((column) => column.name).filter((name) => name.trim() !== ''),
    [columns]
  )

  useEffect(() => {
    if (!connectionId || !databaseName) {
      return
    }

    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        setIsTablesLoading(true)
      }
    })

    void listSchemaObjects(connectionId, databaseName, 'table')
      .then((tables) => {
        if (!cancelled) {
          setReferencedTables(tables)
        }
      })
      .catch((error) => {
        console.error('[foreign-key-editor] Failed to load referenced tables', error)
        if (!cancelled) {
          setReferencedTables([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsTablesLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [connectionId, databaseName])

  useEffect(() => {
    loadedTableColumnsRef.current = new Set()
    loadingTableColumnsRef.current = new Set()
    queueMicrotask(() => {
      setReferencedColumnsByTable({})
      setLoadingColumnsByTable({})
    })
  }, [connectionId, databaseName])

  useEffect(() => {
    if (!connectionId || !databaseName) {
      return
    }

    const referencedTableNames = Array.from(
      new Set(
        foreignKeys
          .map((foreignKey) => foreignKey.referencedTable.trim())
          .filter((referencedTable) => referencedTable !== '')
      )
    )

    referencedTableNames.forEach((referencedTable) => {
      if (
        loadedTableColumnsRef.current.has(referencedTable) ||
        loadingTableColumnsRef.current.has(referencedTable)
      ) {
        return
      }

      loadingTableColumnsRef.current.add(referencedTable)
      setLoadingColumnsByTable((current) => ({
        ...current,
        [referencedTable]: true,
      }))

      void listColumns(connectionId, databaseName, referencedTable)
        .then((loadedColumns) => {
          loadedTableColumnsRef.current.add(referencedTable)
          setReferencedColumnsByTable((current) => ({
            ...current,
            [referencedTable]: loadedColumns.map((column) => column.name),
          }))
        })
        .catch((error) => {
          console.error('[foreign-key-editor] Failed to load referenced columns', error)
          setReferencedColumnsByTable((current) => ({
            ...current,
            [referencedTable]: [],
          }))
        })
        .finally(() => {
          loadingTableColumnsRef.current.delete(referencedTable)
          setLoadingColumnsByTable((current) => ({
            ...current,
            [referencedTable]: false,
          }))
        })
    })
  }, [connectionId, databaseName, foreignKeys])

  const effectiveSelectedRow =
    selectedRow !== null && selectedRow < foreignKeys.length ? selectedRow : null

  if (!tabState) {
    return null
  }

  const canDeleteSelected =
    effectiveSelectedRow !== null &&
    effectiveSelectedRow < foreignKeys.length &&
    !foreignKeys[effectiveSelectedRow]?.isComposite

  const handleDelete = (fkIndex: number) => {
    deleteForeignKey(tabId, fkIndex)
    setSelectedRow((current) => {
      if (current === null) {
        return null
      }

      if (current === fkIndex) {
        return fkIndex > 0 ? fkIndex - 1 : null
      }

      if (current > fkIndex) {
        return current - 1
      }

      return current
    })
  }

  return (
    <div className={styles.container} data-testid="foreign-key-editor">
      <div className={styles.toolbar}>
        <Button
          type="button"
          variant="toolbar"
          onClick={() => {
            addForeignKey(tabId)
            setSelectedRow(foreignKeys.length)
          }}
          data-testid="foreign-key-editor-add"
        >
          <Link size={16} weight="bold" />
          <span>Add FK</span>
        </Button>
        <Button
          type="button"
          variant="toolbarDanger"
          onClick={() => {
            if (effectiveSelectedRow !== null) {
              handleDelete(effectiveSelectedRow)
            }
          }}
          disabled={!canDeleteSelected}
          data-testid="foreign-key-editor-delete-selected"
        >
          <Trash size={16} weight="bold" />
          <span>Delete Selected</span>
        </Button>
      </div>

      <div className={styles.tableScroller}>
        <table className={styles.table}>
          <thead className={styles.tableHead}>
            <tr>
              {[
                '',
                '#',
                'FK Name',
                'Source Column',
                'Referenced Table',
                'Referenced Column',
                'On Delete',
                'On Update',
                '',
              ].map((label, index) => (
                <th key={`${label}-${index}`} className={styles.headerCell} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={styles.tableBody}>
            {foreignKeys.map((foreignKey, fkIndex) => {
              const isSelected = effectiveSelectedRow === fkIndex
              const rowClassName = `${styles.row} ${
                isSelected ? styles.selectedRow : fkIndex % 2 === 0 ? styles.evenRow : styles.oddRow
              }`

              if (foreignKey.isComposite) {
                return (
                  <tr
                    key={`fk-${fkIndex}`}
                    className={rowClassName}
                    data-testid={`fk-row-${fkIndex}`}
                    onClick={() => setSelectedRow(fkIndex)}
                  >
                    <td className={`${styles.bodyCell} ${styles.indicatorCell}`}>
                      <span className={styles.rowAccent} aria-hidden />
                    </td>
                    <td className={`${styles.bodyCell} ${styles.rowNumberCell}`}>{fkIndex + 1}</td>
                    <td className={styles.bodyCell}>
                      <span className={styles.readonlyText}>{foreignKey.name || '—'}</span>
                    </td>
                    <td className={styles.bodyCell} colSpan={4}>
                      <div
                        className={styles.compositeCell}
                        data-testid={`fk-composite-badge-${fkIndex}`}
                      >
                        <span className={styles.warningBadge}>Multi-column — view only</span>
                        <div className={styles.compositeSummary}>
                          <span>{foreignKey.sourceColumn || '—'}</span>
                          <span>→</span>
                          <span>
                            {foreignKey.referencedTable || '—'}.{foreignKey.referencedColumn || '—'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className={styles.bodyCell}>
                      <span className={styles.readonlyText}>{foreignKey.onDelete || '—'}</span>
                    </td>
                    <td className={styles.bodyCell}>
                      <span className={styles.readonlyText}>{foreignKey.onUpdate || '—'}</span>
                    </td>
                    <td className={`${styles.bodyCell} ${styles.deleteCell}`} />
                  </tr>
                )
              }

              const referencedColumnOptions =
                referencedColumnsByTable[foreignKey.referencedTable] ?? []
              const isReferencedColumnLoading = Boolean(
                foreignKey.referencedTable && loadingColumnsByTable[foreignKey.referencedTable]
              )

              return (
                <tr
                  key={`fk-${fkIndex}`}
                  className={rowClassName}
                  data-testid={`fk-row-${fkIndex}`}
                  onClick={() => setSelectedRow(fkIndex)}
                >
                  <td className={`${styles.bodyCell} ${styles.indicatorCell}`}>
                    <span className={styles.rowAccent} aria-hidden />
                  </td>
                  <td className={`${styles.bodyCell} ${styles.rowNumberCell}`}>{fkIndex + 1}</td>
                  <td className={styles.bodyCell}>
                    <input
                      type="text"
                      value={foreignKey.name}
                      className={`${styles.cellInput} ${
                        isSelected ? styles.activeInput : styles.inactiveInput
                      }`}
                      data-testid={`fk-name-${fkIndex}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        updateForeignKey(tabId, fkIndex, 'name', event.target.value)
                      }
                    />
                  </td>
                  <td className={styles.bodyCell}>
                    <select
                      value={foreignKey.sourceColumn}
                      className={`${styles.cellSelect} ${
                        isSelected ? styles.activeInput : styles.inactiveInput
                      }`}
                      data-testid={`fk-source-column-${fkIndex}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        updateForeignKey(tabId, fkIndex, 'sourceColumn', event.target.value)
                      }
                    >
                      <option value="">Select column</option>
                      {columnNames.map((columnName) => (
                        <option key={columnName} value={columnName}>
                          {columnName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={styles.bodyCell}>
                    <select
                      value={foreignKey.referencedTable}
                      className={`${styles.cellSelect} ${
                        isSelected ? styles.activeInput : styles.inactiveInput
                      }`}
                      data-testid={`fk-referenced-table-${fkIndex}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => {
                        updateForeignKey(tabId, fkIndex, 'referencedTable', event.target.value)
                        updateForeignKey(tabId, fkIndex, 'referencedColumn', '')
                      }}
                    >
                      <option value="">
                        {isTablesLoading ? 'Loading tables...' : 'Select table'}
                      </option>
                      {referencedTables.map((tableName) => (
                        <option key={tableName} value={tableName}>
                          {tableName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={styles.bodyCell}>
                    {foreignKey.referencedTable !== '' && referencedColumnOptions.length > 0 ? (
                      <select
                        value={foreignKey.referencedColumn}
                        className={`${styles.cellSelect} ${
                          isSelected ? styles.activeInput : styles.inactiveInput
                        }`}
                        data-testid={`fk-referenced-column-${fkIndex}`}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          updateForeignKey(tabId, fkIndex, 'referencedColumn', event.target.value)
                        }
                      >
                        <option value="">
                          {isReferencedColumnLoading ? 'Loading columns...' : 'Select column'}
                        </option>
                        {referencedColumnOptions.map((columnName) => (
                          <option key={columnName} value={columnName}>
                            {columnName}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={foreignKey.referencedColumn}
                        placeholder="column name"
                        className={`${styles.cellInput} ${
                          isSelected ? styles.activeInput : styles.inactiveInput
                        }`}
                        data-testid={`fk-referenced-column-${fkIndex}`}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          updateForeignKey(tabId, fkIndex, 'referencedColumn', event.target.value)
                        }
                      />
                    )}
                  </td>
                  <td className={styles.bodyCell}>
                    <select
                      value={foreignKey.onDelete}
                      className={`${styles.cellSelect} ${
                        isSelected ? styles.activeInput : styles.inactiveInput
                      }`}
                      data-testid={`fk-on-delete-${fkIndex}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        updateForeignKey(tabId, fkIndex, 'onDelete', event.target.value)
                      }
                    >
                      {ACTION_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={styles.bodyCell}>
                    <select
                      value={foreignKey.onUpdate}
                      className={`${styles.cellSelect} ${
                        isSelected ? styles.activeInput : styles.inactiveInput
                      }`}
                      data-testid={`fk-on-update-${fkIndex}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        updateForeignKey(tabId, fkIndex, 'onUpdate', event.target.value)
                      }
                    >
                      {ACTION_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className={`${styles.bodyCell} ${styles.deleteCell}`}>
                    <Button
                      variant="rowDelete"
                      aria-label={`Delete foreign key ${foreignKey.name || fkIndex + 1}`}
                      data-testid={`fk-delete-${fkIndex}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        handleDelete(fkIndex)
                      }}
                    >
                      <Trash size={14} weight="bold" />
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
