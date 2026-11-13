import type { SchemaMetadataResponse } from './schema'

export interface PlaywrightUpdateOverride {
  available?: boolean
  version?: string
  currentVersion?: string
  body?: string | null
  date?: string | null
  rawJson?: unknown
}

export interface ProcessListPlaywrightApi {
  openInfoPopover?: (connectionId: string, rowIndex: number) => boolean
}

export interface TauriInternals {
  runCallback?: (id: number, data: unknown) => void
  [internalName: string]: unknown
}

declare global {
  var __PLAYWRIGHT_UPDATE_OVERRIDE__: PlaywrightUpdateOverride | undefined
  var __PLAYWRIGHT_SCHEMA_METADATA_OVERRIDE__: SchemaMetadataResponse | undefined
  var __PLAYWRIGHT_COMMAND_PALETTE_RECENTS_OVERRIDE__: string | undefined
  var __PLAYWRIGHT_SCHEMA_METADATA_FULL_DELAY_MS__: number | undefined

  interface Window {
    __TAURI_INTERNALS__?: TauriInternals | null
    __playwrightSessionCounter__?: number
    __mockQueryError__?: unknown
    __mockQueryDelay__?: unknown
    __pendingQueryReject__?: ((reason: Error) => void) | null
    __mockAiError__?: unknown
    __mockAiThinking__?: unknown
    __processListTestApi__?: ProcessListPlaywrightApi
    __workspaceStore__?: unknown
    __toastStore__?: unknown
    __connectionStore__?: unknown
    __queryStore__?: unknown
    __tableDataStore__?: unknown
    __tableDesignerStore__?: unknown
    __objectEditorStore__?: unknown
    __importDialogStore__?: unknown
    __aiStore__?: unknown
    __schemaIndexStore__?: unknown
    __processListStore__?: unknown
    __settingsStore__?: unknown
    __aiMemoryStore__?: unknown
    __updateStore__?: unknown
    __executeActiveQueryPlan__?: (connectionId: string, tabId: string) => void
  }
}
