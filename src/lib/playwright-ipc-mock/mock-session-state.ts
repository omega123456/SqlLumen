import { hasWindow } from '../tauri-env'
import { getCommandPaletteRecentsFixture, getStaticFixture } from '../../tests/playwright-fixtures'

export const COMMAND_PALETTE_RECENTS_SETTING_KEY = 'commandPalette.recents'

function defaultMockDatabase(): string | null {
  return getStaticFixture('savedConnection').defaultDatabase
}

export let activeMockDatabase: string | null = defaultMockDatabase()

interface SessionCounterStore {
  __playwrightSessionCounter__?: number
}

const moduleSessionCounterStore: SessionCounterStore = {}

function getCounterStore(): SessionCounterStore {
  if (hasWindow()) return window
  return moduleSessionCounterStore
}

function allocatePlaywrightSessionId(): string {
  const store = getCounterStore()
  const next = (store.__playwrightSessionCounter__ ?? 0) + 1
  store.__playwrightSessionCounter__ = next
  return `session-playwright-${next}`
}

export function resetPlaywrightSessionAllocator(): void {
  delete getCounterStore().__playwrightSessionCounter__
}

type PlaywrightMockWindowFlag =
  '__mockQueryError__' | '__mockQueryDelay__' | '__mockAiError__' | '__mockAiThinking__'

export function readMockWindowFlag(flag: PlaywrightMockWindowFlag): unknown {
  if (!hasWindow()) return undefined
  return window[flag]
}

type PendingQueryReject = (reason: Error) => void

export function readPendingQueryReject(): PendingQueryReject | null {
  if (!hasWindow()) return null
  return window.__pendingQueryReject__ ?? null
}

export function writePendingQueryReject(reject: PendingQueryReject | null): void {
  if (hasWindow()) window.__pendingQueryReject__ = reject
}

export function getMockUpdateMetadata(): Record<string, unknown> | null {
  const override = globalThis.__PLAYWRIGHT_UPDATE_OVERRIDE__
  if (!override?.available) {
    return null
  }

  const update = getStaticFixture('update')
  return {
    rid: update.rid,
    currentVersion: override.currentVersion ?? update.currentVersion,
    version: override.version ?? update.version,
    date: override.date ?? update.date,
    body: override.body ?? update.body,
    rawJson: override.rawJson ?? null,
  }
}

export function getCommandPaletteRecentsValue(): string {
  return (
    globalThis.__PLAYWRIGHT_COMMAND_PALETTE_RECENTS_OVERRIDE__ ?? getCommandPaletteRecentsFixture()
  )
}

function getSchemaMetadataDelayMs(): number {
  const candidate = globalThis.__PLAYWRIGHT_SCHEMA_METADATA_FULL_DELAY_MS__
  const hasPositiveDelay = typeof candidate === 'number' && candidate > 0
  return hasPositiveDelay ? candidate : 0
}

export async function maybeDelaySchemaMetadata(): Promise<void> {
  const delayMs = getSchemaMetadataDelayMs()
  if (delayMs <= 0) {
    return
  }

  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs)
  })
}

export function openMockConnection(): { sessionId: string; serverVersion: string } {
  activeMockDatabase = defaultMockDatabase()
  return {
    sessionId: allocatePlaywrightSessionId(),
    serverVersion: getStaticFixture('serverVersion'),
  }
}

export function selectMockDatabase({ databaseName }: { databaseName: string | null }): null {
  activeMockDatabase = databaseName ?? null
  return null
}
