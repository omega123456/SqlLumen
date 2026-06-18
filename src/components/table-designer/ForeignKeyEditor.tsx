import { Link, Trash } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { logFrontend } from '../../lib/app-log-commands'
import { listColumns, listDatabases, listSchemaObjects } from '../../lib/schema-commands'
import { useTableDesignerStore } from '../../stores/table-designer-store'
import { Button } from '../common/Button'
import { Dropdown, type DropdownOption } from '../common/Dropdown'
import { TextInput } from '../common/TextInput'
import styles from './ForeignKeyEditor.module.css'

interface ForeignKeyEditorProps {
  tabId: string
}

const ACTION_OPTIONS = ['NO ACTION', 'CASCADE', 'SET NULL', 'RESTRICT']

const ACTION_DROPDOWN_OPTIONS: DropdownOption[] = ACTION_OPTIONS.map((action) => ({
  value: action,
  label: action,
}))

function makeReferencedTargetKey(database: string, table: string): string {
  return `${database}\u0000${table}`
}

export function ForeignKeyEditor({ tabId }: ForeignKeyEditorProps) {
  const tabState = useTableDesignerStore((state) => state.tabs[tabId])
  const addForeignKey = useTableDesignerStore((state) => state.addForeignKey)
  const deleteForeignKey = useTableDesignerStore((state) => state.deleteForeignKey)
  const updateForeignKey = useTableDesignerStore((state) => state.updateForeignKey)

  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [availableDatabases, setAvailableDatabases] = useState<string[]>([])
  const [isDatabasesLoading, setIsDatabasesLoading] = useState(false)
  const [referencedTablesByDatabase, setReferencedTablesByDatabase] = useState<
    Record<string, string[]>
  >({})
  const [loadingTablesByDatabase, setLoadingTablesByDatabase] = useState<Record<string, boolean>>(
    {}
  )
  const [referencedColumnsByTarget, setReferencedColumnsByTarget] = useState<
    Record<string, string[]>
  >({})
  const [loadingColumnsByTarget, setLoadingColumnsByTarget] = useState<Record<string, boolean>>({})

  const loadedTablesRef = useRef<Set<string>>(new Set())
  const loadingTablesRef = useRef<Set<string>>(new Set())
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

  const sourceColumnOptions: DropdownOption[] = useMemo(
    () => [
      { value: '', label: 'Select column' },
      ...columnNames.map((name) => ({ value: name, label: name })),
    ],
    [columnNames]
  )

  const databaseOptions: DropdownOption[] = useMemo(() => {
    const placeholder: DropdownOption = {
      value: '',
      label: isDatabasesLoading ? 'Loading databases...' : 'Select database',
    }

    const databases = new Set(availableDatabases)
    if (databaseName) {
      databases.add(databaseName)
    }

    return [placeholder, ...Array.from(databases).map((name) => ({ value: name, label: name }))]
  }, [availableDatabases, databaseName, isDatabasesLoading])

  useEffect(() => {
    if (!connectionId || !databaseName) {
      return
    }

    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        setIsDatabasesLoading(true)
      }
    })

    void listDatabases(connectionId)
      .then((databases) => {
        if (!cancelled) {
          setAvailableDatabases(
            databases.includes(databaseName) ? databases : [databaseName, ...databases]
          )
        }
      })
      .catch((error) => {
        logFrontend(
          'error',
          ['[foreign-key-editor] Failed to load referenced databases', error].map(String).join(' ')
        )
        if (!cancelled) {
          setAvailableDatabases(databaseName ? [databaseName] : [])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsDatabasesLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [connectionId, databaseName])

  useEffect(() => {
    loadedTablesRef.current = new Set()
    loadingTablesRef.current = new Set()
    loadedTableColumnsRef.current = new Set()
    loadingTableColumnsRef.current = new Set()
    queueMicrotask(() => {
      setReferencedTablesByDatabase({})
      setLoadingTablesByDatabase({})
      setReferencedColumnsByTarget({})
      setLoadingColumnsByTarget({})
    })
  }, [connectionId, databaseName])

  useEffect(() => {
    if (!connectionId || !databaseName) {
      return
    }

    const referencedDatabases = Array.from(
      new Set(
        foreignKeys
          .map((foreignKey) => (foreignKey.referencedDatabase || databaseName).trim())
          .filter((referencedDatabase) => referencedDatabase !== '')
      )
    )

    referencedDatabases.forEach((referencedDatabase) => {
      if (
        loadedTablesRef.current.has(referencedDatabase) ||
        loadingTablesRef.current.has(referencedDatabase)
      ) {
        return
      }

      loadingTablesRef.current.add(referencedDatabase)
      setLoadingTablesByDatabase((current) => ({
        ...current,
        [referencedDatabase]: true,
      }))

      void listSchemaObjects(connectionId, referencedDatabase, 'table')
        .then((tables) => {
          loadedTablesRef.current.add(referencedDatabase)
          setReferencedTablesByDatabase((current) => ({
            ...current,
            [referencedDatabase]: tables,
          }))
        })
        .catch((error) => {
          logFrontend(
            'error',
            ['[foreign-key-editor] Failed to load referenced tables', error].map(String).join(' ')
          )
          setReferencedTablesByDatabase((current) => ({
            ...current,
            [referencedDatabase]: [],
          }))
        })
        .finally(() => {
          loadingTablesRef.current.delete(referencedDatabase)
          setLoadingTablesByDatabase((current) => ({
            ...current,
            [referencedDatabase]: false,
          }))
        })
    })
  }, [connectionId, databaseName, foreignKeys])

  useEffect(() => {
    if (!connectionId || !databaseName) {
      return
    }

    const referencedTargets = Array.from(
      new Set(
        foreignKeys
          .map((foreignKey) => {
            const referencedDatabase = (foreignKey.referencedDatabase || databaseName).trim()
            const referencedTable = foreignKey.referencedTable.trim()
            if (referencedDatabase === '' || referencedTable === '') {
              return ''
            }

            return makeReferencedTargetKey(referencedDatabase, referencedTable)
          })
          .filter((targetKey) => targetKey !== '')
      )
    )

    referencedTargets.forEach((targetKey) => {
      if (
        loadedTableColumnsRef.current.has(targetKey) ||
        loadingTableColumnsRef.current.has(targetKey)
      ) {
        return
      }

      const [referencedDatabase, referencedTable] = targetKey.split('\u0000')
      if (!referencedDatabase || !referencedTable) {
        return
      }

      loadingTableColumnsRef.current.add(targetKey)
      setLoadingColumnsByTarget((current) => ({
        ...current,
        [targetKey]: true,
      }))

      void listColumns(connectionId, referencedDatabase, referencedTable)
        .then((loadedColumns) => {
          loadedTableColumnsRef.current.add(targetKey)
          setReferencedColumnsByTarget((current) => ({
            ...current,
            [targetKey]: loadedColumns.map((column) => column.name),
          }))
        })
        .catch((error) => {
          logFrontend(
            'error',
            ['[foreign-key-editor] Failed to load referenced columns', error].map(String).join(' ')
          )
          setReferencedColumnsByTarget((current) => ({
            ...current,
            [targetKey]: [],
          }))
        })
        .finally(() => {
          loadingTableColumnsRef.current.delete(targetKey)
          setLoadingColumnsByTarget((current) => ({
            ...current,
            [targetKey]: false,
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
          variant="secondary"
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
          variant="danger"
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
                'Referenced DB',
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
                    <td className={styles.bodyCell} colSpan={5}>
                      <div
                        className={styles.compositeCell}
                        data-testid={`fk-composite-badge-${fkIndex}`}
                      >
                        <span className={styles.warningBadge}>Multi-column — view only</span>
                        <div className={styles.compositeSummary}>
                          <span>{foreignKey.sourceColumn || '—'}</span>
                          <span>→</span>
                          <span>
                            {foreignKey.referencedDatabase || databaseName || '—'}.
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

              const referencedDatabase = foreignKey.referencedDatabase || databaseName || ''
              const referencedTableOptions: DropdownOption[] = [
                {
                  value: '',
                  label: loadingTablesByDatabase[referencedDatabase]
                    ? 'Loading tables...'
                    : 'Select table',
                },
                ...(referencedTablesByDatabase[referencedDatabase] ?? []).map((tableName) => ({
                  value: tableName,
                  label: tableName,
                })),
              ]
              const referencedTargetKey =
                referencedDatabase !== '' && foreignKey.referencedTable !== ''
                  ? makeReferencedTargetKey(referencedDatabase, foreignKey.referencedTable)
                  : ''
              const referencedColumnOptions =
                referencedTargetKey === ''
                  ? []
                  : (referencedColumnsByTarget[referencedTargetKey] ?? [])
              const isReferencedColumnLoading = Boolean(
                referencedTargetKey && loadingColumnsByTarget[referencedTargetKey]
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
                    <TextInput
                      type="text"
                      variant="tableCell"
                      value={foreignKey.name}
                      className={`${isSelected ? styles.activeInput : styles.inactiveInput}`}
                      data-testid={`fk-name-${fkIndex}`}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        updateForeignKey(tabId, fkIndex, 'name', event.target.value)
                      }
                    />
                  </td>
                  <td className={styles.bodyCell}>
                    <div onClick={(event) => event.stopPropagation()}>
                      <Dropdown
                        id={`fk-source-column-${tabId}-${fkIndex}`}
                        ariaLabel="Source column"
                        options={sourceColumnOptions}
                        value={foreignKey.sourceColumn}
                        data-testid={`fk-source-column-${fkIndex}`}
                        onChange={(value) =>
                          updateForeignKey(tabId, fkIndex, 'sourceColumn', value)
                        }
                        workspaceTabId={tabId}
                        triggerClassName={`${styles.cellSelect} ${
                          isSelected ? styles.activeInput : styles.inactiveInput
                        }`}
                      />
                    </div>
                  </td>
                  <td className={styles.bodyCell}>
                    <div onClick={(event) => event.stopPropagation()}>
                      <Dropdown
                        id={`fk-referenced-database-${tabId}-${fkIndex}`}
                        ariaLabel="Referenced database"
                        options={databaseOptions}
                        value={referencedDatabase}
                        data-testid={`fk-referenced-database-${fkIndex}`}
                        onChange={(value) => {
                          updateForeignKey(tabId, fkIndex, 'referencedDatabase', value)
                          updateForeignKey(tabId, fkIndex, 'referencedTable', '')
                          updateForeignKey(tabId, fkIndex, 'referencedColumn', '')
                        }}
                        workspaceTabId={tabId}
                        triggerClassName={`${styles.cellSelect} ${
                          isSelected ? styles.activeInput : styles.inactiveInput
                        }`}
                      />
                    </div>
                  </td>
                  <td className={styles.bodyCell}>
                    <div onClick={(event) => event.stopPropagation()}>
                      <Dropdown
                        id={`fk-referenced-table-${tabId}-${fkIndex}`}
                        ariaLabel="Referenced table"
                        options={referencedTableOptions}
                        value={foreignKey.referencedTable}
                        data-testid={`fk-referenced-table-${fkIndex}`}
                        onChange={(value) => {
                          updateForeignKey(tabId, fkIndex, 'referencedTable', value)
                          updateForeignKey(tabId, fkIndex, 'referencedColumn', '')
                        }}
                        workspaceTabId={tabId}
                        triggerClassName={`${styles.cellSelect} ${
                          isSelected ? styles.activeInput : styles.inactiveInput
                        }`}
                        disabled={referencedDatabase === ''}
                      />
                    </div>
                  </td>
                  <td className={styles.bodyCell}>
                    {foreignKey.referencedTable !== '' && referencedColumnOptions.length > 0 ? (
                      <div onClick={(event) => event.stopPropagation()}>
                        <Dropdown
                          id={`fk-referenced-column-${tabId}-${fkIndex}`}
                          ariaLabel="Referenced column"
                          options={[
                            {
                              value: '',
                              label: isReferencedColumnLoading
                                ? 'Loading columns...'
                                : 'Select column',
                            },
                            ...referencedColumnOptions.map((columnName) => ({
                              value: columnName,
                              label: columnName,
                            })),
                          ]}
                          value={foreignKey.referencedColumn}
                          data-testid={`fk-referenced-column-${fkIndex}`}
                          onChange={(value) =>
                            updateForeignKey(tabId, fkIndex, 'referencedColumn', value)
                          }
                          workspaceTabId={tabId}
                          triggerClassName={`${styles.cellSelect} ${
                            isSelected ? styles.activeInput : styles.inactiveInput
                          }`}
                        />
                      </div>
                    ) : (
                      <TextInput
                        type="text"
                        variant="tableCell"
                        value={foreignKey.referencedColumn}
                        placeholder="column name"
                        className={`${isSelected ? styles.activeInput : styles.inactiveInput}`}
                        data-testid={`fk-referenced-column-${fkIndex}`}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          updateForeignKey(tabId, fkIndex, 'referencedColumn', event.target.value)
                        }
                      />
                    )}
                  </td>
                  <td className={styles.bodyCell}>
                    <div onClick={(event) => event.stopPropagation()}>
                      <Dropdown
                        id={`fk-on-delete-${tabId}-${fkIndex}`}
                        ariaLabel="On delete"
                        options={ACTION_DROPDOWN_OPTIONS}
                        value={foreignKey.onDelete}
                        data-testid={`fk-on-delete-${fkIndex}`}
                        onChange={(value) => updateForeignKey(tabId, fkIndex, 'onDelete', value)}
                        workspaceTabId={tabId}
                        triggerClassName={`${styles.cellSelect} ${
                          isSelected ? styles.activeInput : styles.inactiveInput
                        }`}
                      />
                    </div>
                  </td>
                  <td className={styles.bodyCell}>
                    <div onClick={(event) => event.stopPropagation()}>
                      <Dropdown
                        id={`fk-on-update-${tabId}-${fkIndex}`}
                        ariaLabel="On update"
                        options={ACTION_DROPDOWN_OPTIONS}
                        value={foreignKey.onUpdate}
                        data-testid={`fk-on-update-${fkIndex}`}
                        onChange={(value) => updateForeignKey(tabId, fkIndex, 'onUpdate', value)}
                        workspaceTabId={tabId}
                        triggerClassName={`${styles.cellSelect} ${
                          isSelected ? styles.activeInput : styles.inactiveInput
                        }`}
                      />
                    </div>
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
