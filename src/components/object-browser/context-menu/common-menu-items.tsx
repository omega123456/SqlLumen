import {
  ArrowsClockwise,
  ArrowSquareOut,
  CopySimple,
  Export,
  FileCode,
  Info,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react'
import type { CopyObjectSelection } from '../../../lib/copy-to-host-commands'
import type { EditableObjectType } from '../../../types/schema'
import type { BuildMenuArgs, MenuItem, Separator } from './menu-entry-types'

const MENU_ICON_SIZE = 18

interface ActionItemSpec {
  key: string
  label: string
  icon: React.ReactNode
  action: () => void
}

interface CallbackItemSpec {
  key: string
  label: string
  icon: React.ReactNode
  handler: unknown
  run: () => void
  destructive?: boolean
}

export function menuIcon(Icon: typeof Info): React.ReactNode {
  return <Icon size={MENU_ICON_SIZE} weight="regular" />
}

export function separator(key: string): Separator {
  return { key: key, separator: true }
}

export function actionItem(spec: ActionItemSpec): MenuItem {
  return {
    key: spec.key,
    label: spec.label,
    icon: spec.icon,
    disabled: false,
    destructive: false,
    action: spec.action,
  }
}

export function callbackItem(closeMenu: () => void, spec: CallbackItemSpec): MenuItem {
  return {
    key: spec.key,
    label: spec.label,
    icon: spec.icon,
    disabled: !spec.handler,
    destructive: spec.destructive ?? false,
    action: () => {
      spec.run()
      closeMenu()
    },
  }
}

export function schemaInfoItem(args: BuildMenuArgs): MenuItem {
  return actionItem({
    key: 'schema-info',
    label: 'Schema info',
    icon: menuIcon(Info),
    action: args.openSchemaInfoTab,
  })
}

export function copyNameItem(args: BuildMenuArgs, label: string): MenuItem {
  return actionItem({
    key: 'copy-name',
    label: label,
    icon: menuIcon(CopySimple),
    action: args.copyName,
  })
}

export function refreshItem(args: BuildMenuArgs): MenuItem {
  return actionItem({
    key: 'refresh',
    label: 'Refresh',
    icon: menuIcon(ArrowsClockwise),
    action: args.refreshNode,
  })
}

export function exportDumpItem(args: BuildMenuArgs, tableName?: string): MenuItem {
  return callbackItem(args.closeMenu, {
    key: 'export-dump',
    label: 'Export SQL dump...',
    icon: menuIcon(Export),
    handler: args.onExportDump,
    run: () =>
      runExport({
        exporter: args.onExportDump,
        databaseName: args.databaseName,
        tableName: tableName,
      }),
  })
}

export function exportDdlItem(args: BuildMenuArgs, tableName?: string): MenuItem {
  return callbackItem(args.closeMenu, {
    key: 'export-ddl',
    label: 'Export schema DDL...',
    icon: menuIcon(FileCode),
    handler: args.onExportDdl,
    run: () =>
      runExport({
        exporter: args.onExportDdl,
        databaseName: args.databaseName,
        tableName: tableName,
      }),
  })
}

interface ExportRequest {
  exporter: BuildMenuArgs['onExportDump']
  databaseName: string
  tableName: string | undefined
}

function runExport(request: ExportRequest): void {
  const { exporter, databaseName, tableName } = request
  if (tableName === undefined) {
    exporter?.(databaseName)
    return
  }
  exporter?.(databaseName, tableName)
}

export function copyToHostMenuItem(
  args: BuildMenuArgs,
  objectSelection?: CopyObjectSelection
): MenuItem {
  return callbackItem(args.closeMenu, {
    key: 'copy-to-host',
    label: 'Copy to another host...',
    icon: menuIcon(ArrowSquareOut),
    handler: args.onCopyToHost,
    run: () => args.onCopyToHost?.(args.databaseName, objectSelection),
  })
}

export interface EditableObjectKind {
  objectType: EditableObjectType
  typeLabel: string
}

export function alterObjectItem(args: BuildMenuArgs, kind: EditableObjectKind): MenuItem {
  return callbackItem(args.closeMenu, {
    key: `alter-${kind.objectType}`,
    label: `Alter ${kind.typeLabel}...`,
    icon: menuIcon(PencilSimple),
    handler: args.onAlterObject,
    run: () => args.onAlterObject?.(args.databaseName, args.objectName, kind.objectType),
  })
}

export function dropObjectItem(args: BuildMenuArgs, kind: EditableObjectKind): MenuItem {
  return callbackItem(args.closeMenu, {
    key: `drop-${kind.objectType}`,
    label: `Drop ${kind.typeLabel}...`,
    icon: menuIcon(Trash),
    handler: args.onDropObject,
    run: () => args.onDropObject?.(args.databaseName, args.objectName, kind.objectType),
    destructive: true,
  })
}
