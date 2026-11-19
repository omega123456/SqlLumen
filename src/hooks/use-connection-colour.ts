import { useConnectionStore } from '../stores/connection-store'
import {
  colourWithGroup,
  effectiveConnectionColour,
  liveConnectionGroup,
  sessionColour,
  type ColouredProfile,
  type ConnectionColouring,
} from '../lib/connection-colour'
import type { ActiveConnection, ConnectionGroup } from '../types/connection'

export function useEffectiveConnectionColour(profile: ColouredProfile): string | null {
  return useConnectionStore((state) => effectiveConnectionColour(profile, state))
}

export function useLiveConnectionGroup(profile: ColouredProfile): ConnectionGroup | null {
  return useConnectionStore((state) => liveConnectionGroup(profile, state))
}

export function useColourWithGroup(colouring: ConnectionColouring): string | null {
  return useConnectionStore((state) => colourWithGroup(colouring, state.connectionGroups))
}

export function useSessionColour(session: ActiveConnection | undefined): string | null {
  return useConnectionStore((state) => sessionColour(session, state))
}
