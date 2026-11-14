import { makeNodeId, parseNodeId, useSchemaStore } from '../../../stores/schema-store'
import type { useConnectionStore } from '../../../stores/connection-store'
import type { CopyObjectSelection } from '../../../lib/copy-to-host-commands'
import type { NodeType, TreeNode as SchemaTreeNode } from '../../../types/schema'
import { isNodeUnderFilterScope } from '../../../lib/tree-filter'
import { elementOf } from '../../../lib/input-events'

export interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  nodeId: string | null
}

export const CLOSED_MENU: ContextMenuState = { visible: false, x: 0, y: 0, nodeId: null }

const SCHEMA_OBJECT_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'table',
  'view',
  'procedure',
  'function',
  'trigger',
  'event',
])

export interface SqlDumpDialogState {
  open: boolean
  database?: string
  table?: string
  schemaOnly?: boolean
}

export const CLOSED_DUMP_DIALOG: SqlDumpDialogState = { open: false }

export interface CopyToHostDialogState {
  open: boolean
  database?: string
  objectSelection?: CopyObjectSelection
}

export const CLOSED_COPY_TO_HOST_DIALOG: CopyToHostDialogState = { open: false }

export type TreeNodeMap = Record<string, SchemaTreeNode>
export type ActiveConnectionState = ReturnType<
  typeof useConnectionStore.getState
>['activeConnections'][string]

const EDITABLE_TARGET_SELECTOR = 'input, textarea, [contenteditable="true"]'

function hasDatasetValue(element: HTMLElement, key: string, value: string): boolean {
  return element.dataset[key] === value
}

function columnScopeRoot(columnNode: SchemaTreeNode, nodes: TreeNodeMap | null): string | null {
  return nodes?.[columnNode.parentId ?? '']?.parentId ?? null
}

function databaseScopeRoot(databaseNode: SchemaTreeNode, nodes: TreeNodeMap | null): string {
  const dbName = databaseNode.databaseName ?? parseNodeId(databaseNode.id).database
  const tableCategoryId = makeNodeId('category', dbName, 'table')
  return nodes?.[tableCategoryId] ? tableCategoryId : databaseNode.id
}

export function filterScopeRootFor(selectedNode: SchemaTreeNode | null, nodes: TreeNodeMap | null) {
  if (!selectedNode) return null
  if (SCHEMA_OBJECT_TYPES.has(selectedNode.type)) return selectedNode.parentId ?? null
  if (selectedNode.type === 'column') return columnScopeRoot(selectedNode, nodes)
  if (selectedNode.type === 'database') return databaseScopeRoot(selectedNode, nodes)
  return selectedNode.id
}

function hasCommandModifier(event: React.KeyboardEvent): boolean {
  return event.ctrlKey || event.altKey || event.metaKey
}

function isEditableTarget(target: Element | null): boolean {
  if (!target) return true
  return target.closest(EDITABLE_TARGET_SELECTOR) !== null
}

export function shouldIgnoreTreeKey(event: React.KeyboardEvent<HTMLDivElement>): boolean {
  if (event.defaultPrevented) return true
  if (hasCommandModifier(event)) return true
  return isEditableTarget(elementOf(event.target))
}

export function typeAheadFilterValue(key: string, filterText: string): string | null {
  if (key === 'Backspace') return filterText.slice(0, -1)
  const isPrintableCharacter = key.length === 1 && !/\s/.test(key)
  if (!isPrintableCharacter) return null
  return `${filterText}${key}`
}

export function selectedDatabaseName(
  selectedNode: SchemaTreeNode | null,
  selectedNodeId: string | null
): string | null {
  const databaseName = selectedNode?.databaseName
  if (databaseName != null) return databaseName
  if (!selectedNodeId) return null
  return parseNodeId(selectedNodeId).database
}

export function isReadOnlyConnection(activeConnection: ActiveConnectionState | null): boolean {
  return activeConnection?.profile?.readOnly ?? false
}

export function currentRevealSeq(): number {
  return useSchemaStore.getState().revealRequest?.seq ?? 0
}

export function isSchemaObjectType(nodeType: NodeType): boolean {
  return SCHEMA_OBJECT_TYPES.has(nodeType)
}

interface VisibleTopLevelInput {
  nodes: TreeNodeMap | null
  topLevelIds: string[]
  filterMatchIds: Set<string> | undefined
  scopeRoot: string | null
}

interface ScopedFilter {
  nodes: TreeNodeMap
  filterMatchIds: Set<string>
  scopeRoot: string | null
}

function isVisibleTopLevelNode(filter: ScopedFilter, nodeId: string): boolean {
  const { nodes, filterMatchIds, scopeRoot } = filter
  if (!nodes[nodeId]) return false
  if (scopeRoot == null) return filterMatchIds.has(nodeId)
  if (!isNodeUnderFilterScope(nodeId, scopeRoot, nodes)) return true
  return filterMatchIds.has(nodeId)
}

export function visibleTopLevelIdsFor(input: VisibleTopLevelInput): string[] {
  const { nodes, filterMatchIds, topLevelIds } = input
  if (!nodes) return topLevelIds
  if (!filterMatchIds) return topLevelIds
  const filter = { nodes: nodes, filterMatchIds: filterMatchIds, scopeRoot: input.scopeRoot }
  return topLevelIds.filter((nodeId) => isVisibleTopLevelNode(filter, nodeId))
}

export function findElementByDataset(
  container: HTMLElement,
  selector: string,
  match: { key: string; value: string }
): HTMLElement | undefined {
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).find((element) =>
    hasDatasetValue(element, match.key, match.value)
  )
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function focusRowWithoutFocusRing(row: HTMLElement): void {
  row.dataset.suppressFocusRing = 'true'
  const restoreFocusRing = () => {
    delete row.dataset.suppressFocusRing
    row.removeEventListener('keydown', restoreFocusRing)
    row.removeEventListener('blur', restoreFocusRing)
  }
  row.addEventListener('keydown', restoreFocusRing)
  row.addEventListener('blur', restoreFocusRing)
  row.focus({ preventScroll: true })
}
