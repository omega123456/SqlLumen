export type UpdatePlatform = 'macos' | 'windows' | 'linux' | 'unknown'
export type ReadyToFinishAction = 'relaunch' | 'manual-quit'

export interface ReadyToFinishBehavior {
  readyToFinishAction: ReadyToFinishAction
  readyToFinishCta: string
  readyToFinishMessage: string
}

export interface PlatformState extends ReadyToFinishBehavior {
  currentPlatform: UpdatePlatform
}

const LATEST_VERSION_LABEL = 'the latest version'

function getReadyToFinishBehavior(
  currentPlatform: UpdatePlatform,
  availableVersion: string | null
): ReadyToFinishBehavior {
  const version = availableVersion ?? LATEST_VERSION_LABEL

  if (currentPlatform === 'linux') {
    return {
      readyToFinishAction: 'manual-quit',
      readyToFinishCta: 'Got it',
      readyToFinishMessage: `Quit and reopen SqlLumen to finish installing version ${version}.`,
    }
  }

  return {
    readyToFinishAction: 'relaunch',
    readyToFinishCta: 'Restart app',
    readyToFinishMessage: `Restart SqlLumen to finish installing version ${version}.`,
  }
}

export function getPlatformState(
  currentPlatform: UpdatePlatform,
  availableVersion: string | null
): PlatformState {
  return {
    currentPlatform: currentPlatform,
    ...getReadyToFinishBehavior(currentPlatform, availableVersion),
  }
}
