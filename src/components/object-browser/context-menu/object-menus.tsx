import { CopySimple, Play, Rows } from '@phosphor-icons/react'
import type { CopyObjectCategory } from '../../../lib/copy-to-host-commands'
import type { EditableObjectType } from '../../../types/schema'
import {
  actionItem,
  alterObjectItem,
  callbackItem,
  copyNameItem,
  copyToHostMenuItem,
  dropObjectItem,
  menuIcon,
  refreshItem,
  schemaInfoItem,
  separator,
  type EditableObjectKind,
} from './common-menu-items'
import { createObjectItem, createTableItem } from './database-table-menus'
import type { BuildMenuArgs, MenuEntry, MenuItem } from './menu-entry-types'

type RoutineType = 'procedure' | 'function'
type ScheduledObjectType = 'trigger' | 'event'

const COPY_CATEGORY_BY_OBJECT_TYPE: Record<RoutineType | ScheduledObjectType, CopyObjectCategory> =
  {
    procedure: 'procedures',
    function: 'functions',
    trigger: 'triggers',
    event: 'events',
  }

const CATEGORY_OBJECT_TYPES: Record<string, EditableObjectType> = {
  view: 'view',
  procedure: 'procedure',
  function: 'function',
  trigger: 'trigger',
  event: 'event',
}

export function buildColumnMenu(args: BuildMenuArgs): MenuEntry[] {
  return [
    actionItem({
      key: 'copy-name',
      label: 'Copy column name',
      icon: menuIcon(CopySimple),
      action: args.copyName,
    }),
  ]
}

function categoryCreateItems(args: BuildMenuArgs): MenuEntry[] {
  if (args.isReadOnly) return []
  const { categoryType } = args
  const entries: MenuEntry[] = []
  if (categoryType === 'table') entries.push(createTableItem(args))
  const objectType = categoryType ? CATEGORY_OBJECT_TYPES[categoryType] : undefined
  if (objectType) entries.push(createObjectItem(args, objectType, categoryType ?? objectType))
  return entries
}

export function buildCategoryMenu(args: BuildMenuArgs): MenuEntry[] {
  const createItems = categoryCreateItems(args)
  const leadingItems = createItems.length > 0 ? [...createItems, separator('sep-1')] : []
  return [...leadingItems, refreshItem(args)]
}

function viewDataItem(args: BuildMenuArgs): MenuItem {
  return actionItem({
    key: 'view-data',
    label: 'View data',
    icon: menuIcon(Rows),
    action: args.openViewDataTab,
  })
}

const VIEW_KIND: EditableObjectKind = { objectType: 'view', typeLabel: 'view' }

export function buildViewMenu(args: BuildMenuArgs): MenuEntry[] {
  const browseItems = [viewDataItem(args), schemaInfoItem(args)]
  const trailingItems = [copyNameItem(args, 'Copy name'), refreshItem(args)]
  if (args.isReadOnly) return [...browseItems, ...trailingItems]
  return [
    ...browseItems,
    alterObjectItem(args, VIEW_KIND),
    separator('sep-1'),
    dropObjectItem(args, VIEW_KIND),
    separator('sep-2'),
    ...trailingItems,
  ]
}

function objectCopyItems(args: BuildMenuArgs, objectType: RoutineType | ScheduledObjectType) {
  const category = COPY_CATEGORY_BY_OBJECT_TYPE[objectType]
  return [
    copyToHostMenuItem(args, { category: category, name: args.objectName }),
    copyNameItem(args, 'Copy name'),
    refreshItem(args),
  ]
}

function editableObjectItems(args: BuildMenuArgs, kind: EditableObjectKind): MenuEntry[] {
  return [
    alterObjectItem(args, kind),
    separator('sep-1'),
    dropObjectItem(args, kind),
    separator('sep-2'),
  ]
}

function executeRoutineItem(args: BuildMenuArgs, routineType: RoutineType): MenuItem {
  return callbackItem(args.closeMenu, {
    key: 'execute',
    label: 'Execute',
    icon: menuIcon(Play),
    handler: args.onExecuteRoutine,
    run: () => args.onExecuteRoutine?.(args.databaseName, args.objectName, routineType),
  })
}

export function buildRoutineMenu(args: BuildMenuArgs, routineType: RoutineType): MenuEntry[] {
  const copyItems = objectCopyItems(args, routineType)
  if (args.isReadOnly) return [schemaInfoItem(args), ...copyItems]
  return [
    schemaInfoItem(args),
    executeRoutineItem(args, routineType),
    ...editableObjectItems(args, { objectType: routineType, typeLabel: routineType }),
    ...copyItems,
  ]
}

export function buildScheduledObjectMenu(
  args: BuildMenuArgs,
  objectType: ScheduledObjectType
): MenuEntry[] {
  const copyItems = objectCopyItems(args, objectType)
  if (args.isReadOnly) return [schemaInfoItem(args), ...copyItems]
  return [
    schemaInfoItem(args),
    ...editableObjectItems(args, { objectType: objectType, typeLabel: objectType }),
    ...copyItems,
  ]
}
