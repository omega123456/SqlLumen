import { create } from 'zustand'
import { getSetting, setSetting } from '../lib/tauri-commands'
import { logFrontend } from '../lib/app-log-commands'
import { setWebviewZoom } from '../lib/window-commands'

interface ZoomLevelRange {
  first: number
  last: number
  step: number
}

const FINE_ZOOM_RANGE: ZoomLevelRange = { first: 70, last: 110, step: 10 }

const COARSE_ZOOM_RANGE: ZoomLevelRange = { first: 125, last: 200, step: 25 }

function zoomLevelsIn(range: ZoomLevelRange): number[] {
  const levels: number[] = []
  for (let level = range.first; level <= range.last; level += range.step) {
    levels.push(level)
  }
  return levels
}

export const ZOOM_LEVELS: readonly number[] = [
  ...zoomLevelsIn(FINE_ZOOM_RANGE),
  ...zoomLevelsIn(COARSE_ZOOM_RANGE),
]

export const DEFAULT_ZOOM_LEVEL = 100

function applyZoomToDOM(level: number): void {
  setWebviewZoom(level).catch((error: unknown) => {
    logFrontend('warn', `[zoom-store] Failed to apply zoom level ${level}: ${String(error)}`)
  })
}

interface ZoomState {
  zoomLevel: number
  previewSnapshot: number | null
  initialize: () => Promise<void>
  setZoom: (level: number) => Promise<void>
  previewZoom: (level: number) => void
  revertPreview: () => void
  zoomIn: () => Promise<void>
  zoomOut: () => Promise<void>
  resetZoom: () => Promise<void>
}

async function persistZoom(level: number): Promise<void> {
  try {
    await setSetting('appearance.zoom', String(level))
  } catch {
    logFrontend('warn', `[zoom-store] Failed to persist zoom level ${level}`)
  }
}

async function readSavedZoomLevel(): Promise<number | null> {
  try {
    const saved = await getSetting('appearance.zoom')
    if (saved === null) return null
    const level = Number(saved)
    return level > 0 ? level : null
  } catch {
    logFrontend('warn', '[zoom-store] Failed to read zoom setting, using default')
    return null
  }
}

async function initialize(): Promise<void> {
  const level = (await readSavedZoomLevel()) ?? DEFAULT_ZOOM_LEVEL
  applyZoomToDOM(level)
  useZoomStore.setState({ zoomLevel: level })
}

async function setZoom(level: number): Promise<void> {
  applyZoomToDOM(level)
  useZoomStore.setState({ zoomLevel: level, previewSnapshot: null })
  await persistZoom(level)
}

function previewZoom(level: number): void {
  const state = useZoomStore.getState()
  const snapshot = state.previewSnapshot ?? state.zoomLevel
  applyZoomToDOM(level)
  useZoomStore.setState({ zoomLevel: level, previewSnapshot: snapshot })
}

function revertPreview(): void {
  const state = useZoomStore.getState()
  if (state.previewSnapshot !== null) {
    applyZoomToDOM(state.previewSnapshot)
    useZoomStore.setState({ zoomLevel: state.previewSnapshot, previewSnapshot: null })
  }
}

async function zoomIn(): Promise<void> {
  const { zoomLevel } = useZoomStore.getState()
  const next = ZOOM_LEVELS.find((level) => level > zoomLevel)
  if (next !== undefined) {
    applyZoomToDOM(next)
    useZoomStore.setState({ zoomLevel: next, previewSnapshot: null })
    await persistZoom(next)
  }
}

async function zoomOut(): Promise<void> {
  const { zoomLevel } = useZoomStore.getState()
  const previous = [...ZOOM_LEVELS].reverse().find((level) => level < zoomLevel)
  if (previous !== undefined) {
    applyZoomToDOM(previous)
    useZoomStore.setState({ zoomLevel: previous, previewSnapshot: null })
    await persistZoom(previous)
  }
}

async function resetZoom(): Promise<void> {
  applyZoomToDOM(DEFAULT_ZOOM_LEVEL)
  useZoomStore.setState({ zoomLevel: DEFAULT_ZOOM_LEVEL, previewSnapshot: null })
  await persistZoom(DEFAULT_ZOOM_LEVEL)
}

export const useZoomStore = create<ZoomState>()(() => ({
  zoomLevel: DEFAULT_ZOOM_LEVEL,
  previewSnapshot: null,
  initialize: initialize,
  setZoom: setZoom,
  previewZoom: previewZoom,
  revertPreview: revertPreview,
  zoomIn: zoomIn,
  zoomOut: zoomOut,
  resetZoom: resetZoom,
}))
