import type { UpdateState } from '../update-store'
import { getPlatformState, type PlatformState, type UpdatePlatform } from './update-platform'

type VersionedPlatform = Pick<UpdateState, 'currentPlatform' | 'availableVersion'>
type UpdateFailure = PlatformState & Pick<UpdateState, 'status' | 'errorMessage'>

export function withDetectedPlatform(
  state: Pick<UpdateState, 'availableVersion'>,
  platform: UpdatePlatform
): PlatformState {
  return getPlatformState(platform, state.availableVersion)
}

export function clearUpToDateStatus<TState extends VersionedPlatform & Pick<UpdateState, 'status'>>(
  state: TState
): TState | (PlatformState & Partial<UpdateState>) {
  if (state.status !== 'up-to-date') return state
  return {
    status: 'idle',
    availableVersion: null,
    errorMessage: null,
    updateObject: null,
    ...getPlatformState(state.currentPlatform, null),
  }
}

export function failInstall(
  state: VersionedPlatform,
  message: string
): UpdateFailure & Pick<UpdateState, 'updateObject'> {
  return {
    status: 'error',
    errorMessage: message,
    updateObject: null,
    ...getPlatformState(state.currentPlatform, state.availableVersion),
  }
}

export function failRestart(
  state: VersionedPlatform & Pick<UpdateState, 'status'>,
  message: string
): UpdateFailure {
  return {
    status: state.status === 'ready-to-finish' ? 'ready-to-finish' : 'error',
    errorMessage: message,
    ...getPlatformState(state.currentPlatform, state.availableVersion),
  }
}
