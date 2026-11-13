import type { ConnectionTreeState, SchemaState } from '../schema-store'
import { createDefaultConnectionState } from './connection-tree'
import { withoutKey } from '../../lib/record-utils'

type ConnectionStates = Pick<SchemaState, 'connectionStates'>

export interface ConnectionTreePatch {
  connectionId: string
  patch: Partial<ConnectionTreeState>
}

export interface RevealTarget {
  connectionId: string
  nodeId: string
}

export function getConnectionState(state: ConnectionStates, connectionId: string) {
  return state.connectionStates[connectionId] || createDefaultConnectionState()
}

export function isCurrentLoadGeneration(
  state: ConnectionStates,
  connectionId: string,
  generation: number
): boolean {
  return state.connectionStates[connectionId]?.loadGeneration === generation
}

export function patchConnectionTree(
  state: ConnectionStates,
  { connectionId, patch }: ConnectionTreePatch
): ConnectionStates {
  const previous = getConnectionState(state, connectionId)
  return {
    connectionStates: {
      ...state.connectionStates,
      [connectionId]: { ...previous, ...patch },
    },
  }
}

export function nextRevealRequest(
  state: Pick<SchemaState, 'revealRequest'>,
  { connectionId, nodeId }: RevealTarget
): Pick<SchemaState, 'revealRequest'> {
  return {
    revealRequest: {
      connectionId: connectionId,
      nodeId: nodeId,
      seq: (state.revealRequest?.seq ?? 0) + 1,
    },
  }
}

export function removeConnectionTree(
  state: ConnectionStates,
  connectionId: string
): ConnectionStates {
  return { connectionStates: withoutKey(state.connectionStates, connectionId) }
}
