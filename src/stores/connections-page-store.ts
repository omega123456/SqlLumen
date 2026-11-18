import { create } from 'zustand'
import type { ConnectionFormSeed } from '../types/connection'

export type ProfileTarget =
  { kind: 'existing'; profileId: string } | { kind: 'new'; seed: ConnectionFormSeed | null }

export type ConnectionsPageView = { kind: 'board' } | { kind: 'profile'; target: ProfileTarget }

type LeaveAction = () => void

interface ConnectionsPageState {
  isOpen: boolean
  view: ConnectionsPageView
  hasUnsavedEdits: boolean
  pendingLeave: LeaveAction | null

  openPage: () => void
  closePage: () => void
  showBoard: () => void
  showProfile: (target: ProfileTarget) => void
  setUnsavedEdits: (hasUnsavedEdits: boolean) => void
  requestLeave: (leave: LeaveAction) => void
  confirmLeave: () => void
  cancelLeave: () => void
}

const BOARD_VIEW: ConnectionsPageView = { kind: 'board' }

const SETTLED_BOARD = {
  view: BOARD_VIEW,
  hasUnsavedEdits: false,
  pendingLeave: null,
}

function openPage(): void {
  useConnectionsPageStore.setState({ ...SETTLED_BOARD, isOpen: true })
}

function closePage(): void {
  useConnectionsPageStore.setState({ ...SETTLED_BOARD, isOpen: false })
}

function showBoard(): void {
  useConnectionsPageStore.setState(SETTLED_BOARD)
}

function showProfile(target: ProfileTarget): void {
  useConnectionsPageStore.setState({ view: { kind: 'profile', target: target } })
}

function setUnsavedEdits(hasUnsavedEdits: boolean): void {
  useConnectionsPageStore.setState({ hasUnsavedEdits: hasUnsavedEdits })
}

function requestLeave(leave: LeaveAction): void {
  if (!useConnectionsPageStore.getState().hasUnsavedEdits) {
    leave()
    return
  }
  useConnectionsPageStore.setState({ pendingLeave: leave })
}

function confirmLeave(): void {
  const leave = useConnectionsPageStore.getState().pendingLeave
  useConnectionsPageStore.setState({ hasUnsavedEdits: false, pendingLeave: null })
  leave?.()
}

function cancelLeave(): void {
  useConnectionsPageStore.setState({ pendingLeave: null })
}

export const useConnectionsPageStore = create<ConnectionsPageState>()(() => ({
  isOpen: false,
  ...SETTLED_BOARD,
  openPage: openPage,
  closePage: closePage,
  showBoard: showBoard,
  showProfile: showProfile,
  setUnsavedEdits: setUnsavedEdits,
  requestLeave: requestLeave,
  confirmLeave: confirmLeave,
  cancelLeave: cancelLeave,
}))
