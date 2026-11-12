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

export const useZoomStore = create<ZoomState>()((set, get) => ({
  zoomLevel: DEFAULT_ZOOM_LEVEL,
  previewSnapshot: null,

  initialize: async () => {
    try {
      const saved = await getSetting('appearance.zoom')
      if (saved !== null) {
        const level = Number(saved)
        if (!isNaN(level) && level > 0) {
          applyZoomToDOM(level)
          set({ zoomLevel: level })
          return
        }
      }
    } catch {
      logFrontend('warn', '[zoom-store] Failed to read zoom setting, using default')
    }
    applyZoomToDOM(DEFAULT_ZOOM_LEVEL)
    set({ zoomLevel: DEFAULT_ZOOM_LEVEL })
  },

  setZoom: async (level: number) => {
    applyZoomToDOM(level)
    set({ zoomLevel: level, previewSnapshot: null })
    await persistZoom(level)
  },

  previewZoom: (level: number) => {
    const state = get()
    const snapshot = state.previewSnapshot ?? state.zoomLevel
    applyZoomToDOM(level)
    set({ zoomLevel: level, previewSnapshot: snapshot })
  },

  revertPreview: () => {
    const state = get()
    if (state.previewSnapshot !== null) {
      applyZoomToDOM(state.previewSnapshot)
      set({ zoomLevel: state.previewSnapshot, previewSnapshot: null })
    }
  },

  zoomIn: async () => {
    const { zoomLevel } = get()
    const next = ZOOM_LEVELS.find((level) => level > zoomLevel)
    if (next !== undefined) {
      applyZoomToDOM(next)
      set({ zoomLevel: next, previewSnapshot: null })
      await persistZoom(next)
    }
  },

  zoomOut: async () => {
    const { zoomLevel } = get()
    const previous = [...ZOOM_LEVELS].reverse().find((level) => level < zoomLevel)
    if (previous !== undefined) {
      applyZoomToDOM(previous)
      set({ zoomLevel: previous, previewSnapshot: null })
      await persistZoom(previous)
    }
  },

  resetZoom: async () => {
    applyZoomToDOM(DEFAULT_ZOOM_LEVEL)
    set({ zoomLevel: DEFAULT_ZOOM_LEVEL, previewSnapshot: null })
    await persistZoom(DEFAULT_ZOOM_LEVEL)
  },
}))
