import type { NodeType } from '../../../types/schema'
import { buildDatabaseMenu, buildTableMenu } from './database-table-menus'
import type { BuildMenuArgs, MenuEntry } from './menu-entry-types'
import {
  buildCategoryMenu,
  buildColumnMenu,
  buildRoutineMenu,
  buildScheduledObjectMenu,
  buildViewMenu,
} from './object-menus'

type MenuBuilder = (args: BuildMenuArgs) => MenuEntry[]

const MENU_BUILDERS_BY_NODE_TYPE: Partial<Record<NodeType, MenuBuilder>> = {
  database: buildDatabaseMenu,
  table: buildTableMenu,
  view: buildViewMenu,
  procedure: (args) => buildRoutineMenu(args, 'procedure'),
  function: (args) => buildRoutineMenu(args, 'function'),
  trigger: (args) => buildScheduledObjectMenu(args, 'trigger'),
  event: (args) => buildScheduledObjectMenu(args, 'event'),
  category: buildCategoryMenu,
  column: buildColumnMenu,
}

export function buildMenuEntries(args: BuildMenuArgs): MenuEntry[] {
  const buildMenu = MENU_BUILDERS_BY_NODE_TYPE[args.nodeType]
  if (!buildMenu) return []
  return buildMenu(args)
}
