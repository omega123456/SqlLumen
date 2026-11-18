import type { ActiveConnection, ConnectionGroup, SavedConnection } from '../../../types/connection'
import type { SavedConnectionsLoad } from '../../../stores/connection-store'
import { DEFAULT_MYSQL_PORT, type ComposerText } from '../../../lib/mysql-connection-url'
import {
  buildConnectionSections,
  filterConnectionsByQuery,
  sectionKey,
  sectionTitle,
  shouldHideSection,
  type ConnectionSection,
} from './connection-sections'

export const RECENT_LIMIT = 4
export const RECENT_HIDDEN_AT_OR_BELOW = 6
const RECENT_SECTION_KEY = 'recent'
const RECENT_SECTION_TITLE = 'Recent'

export type BoardState = 'loading' | 'failed' | 'empty' | 'no-match' | 'url' | 'sections'

export type BoardSectionKind = 'recent' | 'group' | 'ungrouped'

export interface BoardSection {
  key: string
  title: string
  kind: BoardSectionKind
  groupId: string | null
  connections: SavedConnection[]
}

export interface BoardStateInputs {
  load: SavedConnectionsLoad
  composer: ComposerText
  savedCount: number
  visibleCount: number
}

const LOAD_BOARD_STATE: Record<SavedConnectionsLoad['status'], BoardState | null> = {
  idle: 'loading',
  loading: 'loading',
  failed: 'failed',
  ready: null,
}

export function boardStateOf(inputs: BoardStateInputs): BoardState {
  const loadState = LOAD_BOARD_STATE[inputs.load.status]
  if (loadState) return loadState
  const isUrlText = inputs.composer.kind !== 'search'
  if (isUrlText) return 'url'
  if (inputs.savedCount === 0) return 'empty'
  if (inputs.visibleCount === 0) return 'no-match'
  return 'sections'
}

export interface BoardSectionInputs {
  savedConnections: SavedConnection[]
  connectionGroups: ConnectionGroup[]
  query: string
}

function hasConnected(connection: SavedConnection): boolean {
  return connection.lastConnectedAt !== null
}

function byMostRecentConnect(left: SavedConnection, right: SavedConnection): number {
  return (right.lastConnectedAt ?? '').localeCompare(left.lastConnectedAt ?? '')
}

function recentConnections(savedConnections: SavedConnection[]): SavedConnection[] {
  return savedConnections.filter(hasConnected).sort(byMostRecentConnect).slice(0, RECENT_LIMIT)
}

function showsRecent(inputs: BoardSectionInputs): boolean {
  const isFiltering = inputs.query.trim() !== ''
  if (isFiltering) return false
  return inputs.savedConnections.length > RECENT_HIDDEN_AT_OR_BELOW
}

function recentSection(savedConnections: SavedConnection[]): BoardSection {
  return {
    key: RECENT_SECTION_KEY,
    title: RECENT_SECTION_TITLE,
    kind: 'recent',
    groupId: null,
    connections: recentConnections(savedConnections),
  }
}

function sectionKind(section: ConnectionSection): BoardSectionKind {
  return section.groupId === null ? 'ungrouped' : 'group'
}

function toBoardSection(section: ConnectionSection): BoardSection {
  return {
    key: sectionKey(section),
    title: sectionTitle(section),
    kind: sectionKind(section),
    groupId: section.groupId,
    connections: section.connections,
  }
}

function groupSections(inputs: BoardSectionInputs): BoardSection[] {
  const isFiltering = inputs.query.trim() !== ''
  const isVisible = (section: ConnectionSection) =>
    !shouldHideSection({ section: section, isFiltering: isFiltering, isRenaming: false })
  const filtered = filterConnectionsByQuery(inputs.savedConnections, inputs.query)
  return buildConnectionSections(filtered, inputs.connectionGroups)
    .filter(isVisible)
    .map(toBoardSection)
}

export function buildBoardSections(inputs: BoardSectionInputs): BoardSection[] {
  const sections = groupSections(inputs)
  if (!showsRecent(inputs)) return sections
  const recent = recentSection(inputs.savedConnections)
  const hasRecentConnections = recent.connections.length > 0
  if (!hasRecentConnections) return sections
  return [recent, ...sections]
}

export function visibleConnectionCount(sections: BoardSection[]): number {
  return sections
    .filter((section) => section.kind !== 'recent')
    .reduce((total, section) => total + section.connections.length, 0)
}

export function hostLabel(connection: SavedConnection): string {
  if (connection.port === DEFAULT_MYSQL_PORT) return connection.host
  return `${connection.host}:${connection.port}`
}

export function openSessionOf(
  activeConnections: Record<string, ActiveConnection>,
  profileId: string
): string | null {
  const session = Object.values(activeConnections).find(
    (connection) => connection.profile.id === profileId
  )
  return session?.id ?? null
}

export function isProfileOpen(
  activeConnections: Record<string, ActiveConnection>,
  profileId: string
): boolean {
  return openSessionOf(activeConnections, profileId) !== null
}

export function tileKey(section: BoardSection, connection: SavedConnection): string {
  return `${section.key}:${connection.id}`
}

export function savedServersLabel(count: number): string {
  if (count === 1) return '1 saved server'
  return `${count} saved servers`
}
