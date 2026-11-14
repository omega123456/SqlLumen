import type { CopyObjectSelection } from '../../../lib/copy-to-host-commands'
import type { EditableObjectType, NodeType } from '../../../types/schema'

export interface MenuItem {
  key: string
  label: string
  icon: React.ReactNode
  disabled: boolean
  destructive: boolean
  title?: string
  action: () => void
}

export interface Separator {
  key: string
  separator: true
}

export type MenuEntry = MenuItem | Separator

export type CopyToHostAction = (databaseName: string, objectSelection?: CopyObjectSelection) => void

export function isSeparator(entry: MenuEntry): entry is Separator {
  return 'separator' in entry && entry.separator
}

export interface BuildMenuArgs {
  nodeType: NodeType
  databaseName: string
  objectName: string
  categoryType?: string
  isReadOnly: boolean
  openSchemaInfoTab: () => void
  openViewDataTab: () => void
  copyName: () => void
  refreshNode: () => void
  onCreateDatabase?: () => void
  onAlterDatabase?: (databaseName: string) => void
  onRenameDatabase?: (databaseName: string) => void
  onDropDatabase?: (databaseName: string) => void
  onDropTable?: (databaseName: string, tableName: string) => void
  onTruncateTable?: (databaseName: string, tableName: string) => void
  onRenameTable?: (databaseName: string, tableName: string) => void
  onDesignTable?: (databaseName: string, tableName: string) => void
  onCreateTable?: (databaseName: string) => void
  onAlterObject?: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  onDropObject?: (databaseName: string, objectName: string, objectType: EditableObjectType) => void
  onCreateObject?: (databaseName: string, objectType: EditableObjectType) => void
  onExecuteRoutine?: (
    databaseName: string,
    routineName: string,
    routineType: 'procedure' | 'function'
  ) => void
  onExportDump?: (databaseName: string, tableName?: string) => void
  onExportDdl?: (databaseName: string, tableName?: string) => void
  onCopyToHost?: CopyToHostAction
  closeMenu: () => void
}

function hasTrailingSeparator(entries: MenuEntry[]): boolean {
  if (entries.length === 0) return false
  return isSeparator(entries[entries.length - 1])
}

function isRedundantSeparator(entry: MenuEntry, keptEntries: MenuEntry[]): boolean {
  if (!isSeparator(entry)) return false
  return keptEntries.length === 0 || hasTrailingSeparator(keptEntries)
}

export function cleanSeparators(entries: MenuEntry[]): MenuEntry[] {
  const result: MenuEntry[] = []
  for (const entry of entries) {
    if (!isRedundantSeparator(entry, result)) {
      result.push(entry)
    }
  }
  while (hasTrailingSeparator(result)) {
    result.pop()
  }
  return result
}
