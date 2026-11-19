import type { CSSProperties } from 'react'
import {
  CaretLineLeftIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CaretLineRightIcon,
} from '@phosphor-icons/react'
import type { ActiveConnection } from '../../../types/connection'

export const CONNECTION_TAB_TEST_ID_PREFIX = 'connection-session-tab-'

export const UNNAMED_CONNECTION_LABEL = 'Unnamed connection'

export interface PendingConnectionClose {
  id: string
  displayName: string
  hostPort: string
}

export function hostPortOf(connection: ActiveConnection): string {
  return `${connection.profile.host}:${connection.profile.port}`
}

export function connectionBaseName(connection: ActiveConnection): string {
  const trimmedName = connection.profile.name.trim()
  if (trimmedName === '') return UNNAMED_CONNECTION_LABEL
  return trimmedName
}

export function connectionTabDisplayName(
  connection: ActiveConnection,
  tabsByProfileId: Map<string, ActiveConnection[]>
): string {
  const baseName = connectionBaseName(connection)
  const siblings = tabsByProfileId.get(connection.profile.id) ?? []
  const position = siblings.findIndex((sibling) => sibling.id === connection.id) + 1
  if (position <= 1) return baseName
  return `${baseName} (${position})`
}

export function groupTabsByProfile(tabs: ActiveConnection[]): Map<string, ActiveConnection[]> {
  const tabsByProfileId = new Map<string, ActiveConnection[]>()
  for (const connection of tabs) {
    const profileId = connection.profile.id
    const profileTabs = tabsByProfileId.get(profileId) ?? []
    profileTabs.push(connection)
    tabsByProfileId.set(profileId, profileTabs)
  }
  return tabsByProfileId
}

export function connectionTabTitle(
  displayName: string,
  connection: ActiveConnection,
  groupName: string | null
): string {
  const groupSuffix = groupName === null ? '' : ` · ${groupName} group`
  const readOnlySuffix = connection.profile.readOnly ? ' — Read-only' : ''
  return `${displayName} (${hostPortOf(connection)})${groupSuffix}${readOnlySuffix}`
}

export interface ConnectionEdgeFill {
  className: string
  style: CSSProperties | undefined
}

export function connectionEdgeFill(edgeColor: string | null): ConnectionEdgeFill {
  if (!edgeColor) {
    return { className: 'bg-light-stroke-card dark:bg-dark-stroke-card', style: undefined }
  }
  return { className: '', style: { backgroundColor: edgeColor } }
}

export interface MoveMenuInputs {
  sessionId: string
  tabIndex: number
  tabCount: number
  reorder: (sessionId: string, index: number) => void
  move: (sessionId: string, direction: 'left' | 'right') => void
}

export function connectionMoveMenuItems(inputs: MoveMenuInputs) {
  const isFirstOrMissing = inputs.tabIndex <= 0
  const isLastOrMissing = inputs.tabIndex < 0 || inputs.tabIndex >= inputs.tabCount - 1
  return [
    {
      key: 'move-start',
      label: 'Move to start',
      icon: <CaretLineLeftIcon size={14} weight="regular" />,
      disabled: isFirstOrMissing,
      onSelect: () => inputs.reorder(inputs.sessionId, 0),
    },
    {
      key: 'move-left',
      label: 'Move left',
      icon: <CaretLeftIcon size={14} weight="regular" />,
      disabled: isFirstOrMissing,
      onSelect: () => inputs.move(inputs.sessionId, 'left'),
    },
    {
      key: 'move-right',
      label: 'Move right',
      icon: <CaretRightIcon size={14} weight="regular" />,
      disabled: isLastOrMissing,
      onSelect: () => inputs.move(inputs.sessionId, 'right'),
    },
    {
      key: 'move-end',
      label: 'Move to end',
      icon: <CaretLineRightIcon size={14} weight="regular" />,
      disabled: isLastOrMissing,
      onSelect: () => inputs.reorder(inputs.sessionId, inputs.tabCount),
    },
  ]
}

function connectionTabElement(sessionId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-testid="${CONNECTION_TAB_TEST_ID_PREFIX}${sessionId}"]`
  )
}

export function focusConnectionTab(sessionId: string): boolean {
  const tabElement = connectionTabElement(sessionId)
  if (!tabElement) {
    return false
  }
  const labelButton = tabElement.querySelector<HTMLElement>('[role="button"],button')
  const focusTarget = labelButton ?? tabElement
  focusTarget.focus()
  return true
}
