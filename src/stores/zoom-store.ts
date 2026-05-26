import { create } from 'zustand'
import { getSetting, setSetting } from '../lib/tauri-commands'
import { logFrontend } from '../lib/app-log-commands'

export const ZOOM_LEVELS = [70, 80, 90, 100, 110, 125, 150, 175, 200] as const

function applyZoomToDOM(level: number): void {
  document.documentElement.style.zoom = `${level}%`
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
  zoomLevel: 100,
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
    applyZoomToDOM(100)
    set({ zoomLevel: 100 })
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
    const next = ZOOM_LEVELS.find((l) => l > zoomLevel)
    if (next !== undefined) {
      applyZoomToDOM(next)
      set({ zoomLevel: next, previewSnapshot: null })
      await persistZoom(next)
    }
  },

  zoomOut: async () => {
    const { zoomLevel } = get()
    const prev = [...ZOOM_LEVELS].reverse().find((l) => l < zoomLevel)
    if (prev !== undefined) {
      applyZoomToDOM(prev)
      set({ zoomLevel: prev, previewSnapshot: null })
      await persistZoom(prev)
    }
  },

  resetZoom: async () => {
    applyZoomToDOM(100)
    set({ zoomLevel: 100, previewSnapshot: null })
    await persistZoom(100)
  },
}))
