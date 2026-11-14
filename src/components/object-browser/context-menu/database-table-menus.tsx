import {
  Database,
  Eraser,
  ListNumbers,
  PencilSimple,
  PlusCircle,
  Table,
  Trash,
  Wrench,
} from '@phosphor-icons/react'
import type { CopyObjectSelection } from '../../../lib/copy-to-host-commands'
import type { EditableObjectType } from '../../../types/schema'
import {
  callbackItem,
  copyNameItem,
  copyToHostMenuItem,
  exportDdlItem,
  exportDumpItem,
  menuIcon,
  refreshItem,
  schemaInfoItem,
  separator,
} from './common-menu-items'
import type { BuildMenuArgs, MenuEntry, MenuItem } from './menu-entry-types'

const DATABASE_CREATABLE_OBJECTS: EditableObjectType[] = [
  'view',
  'procedure',
  'function',
  'trigger',
  'event',
]

export function createTableItem(args: BuildMenuArgs): MenuItem {
  return callbackItem(args.closeMenu, {
    key: 'create-table',
    label: 'Create table...',
    icon: menuIcon(Table),
    handler: args.onCreateTable,
    run: () => args.onCreateTable?.(args.databaseName),
  })
}

export function createObjectItem(
  args: BuildMenuArgs,
  objectType: EditableObjectType,
  typeLabel: string
): MenuItem {
  return callbackItem(args.closeMenu, {
    key: `create-${objectType}`,
    label: `Create ${typeLabel}...`,
    icon: menuIcon(PlusCircle),
    handler: args.onCreateObject,
    run: () => args.onCreateObject?.(args.databaseName, objectType),
  })
}

function databaseExportItems(args: BuildMenuArgs): MenuEntry[] {
  return [exportDumpItem(args), copyToHostMenuItem(args), exportDdlItem(args)]
}

function databaseCreateItems(args: BuildMenuArgs): MenuEntry[] {
  return [
    callbackItem(args.closeMenu, {
      key: 'create-database',
      label: 'Create database...',
      icon: menuIcon(PlusCircle),
      handler: args.onCreateDatabase,
      run: () => args.onCreateDatabase?.(),
    }),
    createTableItem(args),
    ...DATABASE_CREATABLE_OBJECTS.map((objectType) =>
      createObjectItem(args, objectType, objectType)
    ),
  ]
}

function databaseChangeItems(args: BuildMenuArgs): MenuEntry[] {
  return [
    callbackItem(args.closeMenu, {
      key: 'alter-database',
      label: 'Alter database...',
      icon: menuIcon(Database),
      handler: args.onAlterDatabase,
      run: () => args.onAlterDatabase?.(args.databaseName),
    }),
    callbackItem(args.closeMenu, {
      key: 'rename-database',
      label: 'Rename database...',
      icon: menuIcon(PencilSimple),
      handler: args.onRenameDatabase,
      run: () => args.onRenameDatabase?.(args.databaseName),
    }),
  ]
}

function dropDatabaseItem(args: BuildMenuArgs): MenuItem {
  return callbackItem(args.closeMenu, {
    key: 'drop-database',
    label: 'Drop database...',
    icon: menuIcon(Trash),
    handler: args.onDropDatabase,
    run: () => args.onDropDatabase?.(args.databaseName),
    destructive: true,
  })
}

export function buildDatabaseMenu(args: BuildMenuArgs): MenuEntry[] {
  if (args.isReadOnly) {
    return [...databaseExportItems(args), separator('sep-ro-1'), refreshItem(args)]
  }
  return [
    ...databaseCreateItems(args),
    ...databaseChangeItems(args),
    separator('sep-1'),
    ...databaseExportItems(args),
    separator('sep-2'),
    dropDatabaseItem(args),
    separator('sep-3'),
    refreshItem(args),
  ]
}

function tableCopySelection(args: BuildMenuArgs): CopyObjectSelection {
  return { category: 'tables', name: args.objectName }
}

function selectTopRowsItem(): MenuItem {
  return {
    key: 'select-rows',
    label: 'Select top 100 rows',
    icon: menuIcon(ListNumbers),
    disabled: true,
    destructive: false,
    action: () => {},
  }
}

function tableCallbackItem(
  args: BuildMenuArgs,
  spec: { key: string; label: string; icon: React.ReactNode; destructive?: boolean },
  handler: BuildMenuArgs['onDropTable']
): MenuItem {
  return callbackItem(args.closeMenu, {
    ...spec,
    handler: handler,
    run: () => handler?.(args.databaseName, args.objectName),
  })
}

function tableDestructiveItems(args: BuildMenuArgs): MenuEntry[] {
  return [
    tableCallbackItem(
      args,
      {
        key: 'truncate-table',
        label: 'Truncate table...',
        icon: menuIcon(Eraser),
        destructive: true,
      },
      args.onTruncateTable
    ),
    tableCallbackItem(
      args,
      { key: 'drop-table', label: 'Drop table...', icon: menuIcon(Trash), destructive: true },
      args.onDropTable
    ),
  ]
}

function readOnlyTableMenu(args: BuildMenuArgs): MenuEntry[] {
  return [
    schemaInfoItem(args),
    exportDumpItem(args, args.objectName),
    separator('sep-ro-1'),
    copyToHostMenuItem(args, tableCopySelection(args)),
    copyNameItem(args, 'Copy table name'),
    refreshItem(args),
  ]
}

export function buildTableMenu(args: BuildMenuArgs): MenuEntry[] {
  if (args.isReadOnly) return readOnlyTableMenu(args)
  return [
    createTableItem(args),
    selectTopRowsItem(),
    tableCallbackItem(
      args,
      { key: 'design-table', label: 'Alter table...', icon: menuIcon(Wrench) },
      args.onDesignTable
    ),
    schemaInfoItem(args),
    separator('sep-1'),
    exportDumpItem(args, args.objectName),
    copyToHostMenuItem(args, tableCopySelection(args)),
    exportDdlItem(args, args.objectName),
    separator('sep-2'),
    ...tableDestructiveItems(args),
    separator('sep-3'),
    tableCallbackItem(
      args,
      { key: 'rename-table', label: 'Rename table...', icon: menuIcon(PencilSimple) },
      args.onRenameTable
    ),
    copyNameItem(args, 'Copy table name'),
    refreshItem(args),
  ]
}
