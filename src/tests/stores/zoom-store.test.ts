import { waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { ipc } from '../ipc-mock'
import { useZoomStore, ZOOM_LEVELS } from '../../stores/zoom-store'

beforeEach(() => {
  useZoomStore.setState({
    zoomLevel: 100,
    previewSnapshot: null,
  })
})

const appliedZoom = () => ipc.calls('plugin:webview|set_webview_zoom').slice(-1)[0]

describe('zoom-store', () => {
  describe('initialize', () => {
    it('reads saved setting and applies it', async () => {
      ipc.override('get_setting', () => '125')
      await useZoomStore.getState().initialize()
      expect(useZoomStore.getState().zoomLevel).toBe(125)
      expect(appliedZoom()).toEqual({ label: 'main', value: 1.25 })
    })

    it('falls back to 100 when setting is null', async () => {
      ipc.override('get_setting', () => null)
      await useZoomStore.getState().initialize()
      expect(useZoomStore.getState().zoomLevel).toBe(100)
      expect(appliedZoom()).toEqual({ label: 'main', value: 1 })
    })

    it('falls back to 100 on IPC error', async () => {
      ipc.override('get_setting', () => {
        throw new Error('IPC error')
      })
      await useZoomStore.getState().initialize()
      expect(useZoomStore.getState().zoomLevel).toBe(100)
      expect(appliedZoom()).toEqual({ label: 'main', value: 1 })
    })
  })

  it('logs instead of throwing when the webview zoom cannot be applied', async () => {
    ipc.override('plugin:webview|set_webview_zoom', () => {
      throw new Error('denied')
    })
    useZoomStore.getState().previewZoom(125)
    expect(useZoomStore.getState().zoomLevel).toBe(125)
    await waitFor(() =>
      expect(
        ipc
          .calls('log_frontend')
          .some((call) => String((call as { message: string }).message).includes('denied'))
      ).toBe(true)
    )
  })

  describe('setZoom', () => {
    it('applies zoom to DOM and persists', async () => {
      ipc.override('set_setting', () => null)
      await useZoomStore.getState().setZoom(125)
      expect(useZoomStore.getState().zoomLevel).toBe(125)
      expect(appliedZoom()).toEqual({ label: 'main', value: 1.25 })
      const calls = ipc.calls('set_setting')
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ key: 'appearance.zoom', value: '125' })
    })
  })

  describe('previewZoom / revertPreview', () => {
    it('previews without persisting and reverts correctly', async () => {
      ipc.override('set_setting', () => null)
      // Start at 100
      useZoomStore.setState({ zoomLevel: 100 })

      // Preview to 150
      useZoomStore.getState().previewZoom(150)
      expect(useZoomStore.getState().zoomLevel).toBe(150)
      expect(useZoomStore.getState().previewSnapshot).toBe(100)
      expect(appliedZoom()).toEqual({ label: 'main', value: 1.5 })
      // No persistence calls
      expect(ipc.calls('set_setting')).toHaveLength(0)

      // Preview again to 175 — snapshot should stay at 100
      useZoomStore.getState().previewZoom(175)
      expect(useZoomStore.getState().previewSnapshot).toBe(100)
      expect(useZoomStore.getState().zoomLevel).toBe(175)

      // Revert
      useZoomStore.getState().revertPreview()
      expect(useZoomStore.getState().zoomLevel).toBe(100)
      expect(useZoomStore.getState().previewSnapshot).toBeNull()
      expect(appliedZoom()).toEqual({ label: 'main', value: 1 })
      expect(ipc.calls('set_setting')).toHaveLength(0)
    })

    it('revertPreview is no-op when no snapshot', () => {
      useZoomStore.getState().revertPreview()
      expect(useZoomStore.getState().zoomLevel).toBe(100)
    })
  })

  describe('zoomIn', () => {
    it('steps to next higher level', async () => {
      ipc.override('set_setting', () => null)
      useZoomStore.setState({ zoomLevel: 100 })
      await useZoomStore.getState().zoomIn()
      expect(useZoomStore.getState().zoomLevel).toBe(110)
      expect(appliedZoom()).toEqual({ label: 'main', value: 1.1 })
    })

    it('no-op at max level', async () => {
      ipc.override('set_setting', () => null)
      const max = ZOOM_LEVELS[ZOOM_LEVELS.length - 1]
      useZoomStore.setState({ zoomLevel: max })
      await useZoomStore.getState().zoomIn()
      expect(useZoomStore.getState().zoomLevel).toBe(max)
      expect(ipc.calls('set_setting')).toHaveLength(0)
    })
  })

  describe('zoomOut', () => {
    it('steps to next lower level', async () => {
      ipc.override('set_setting', () => null)
      useZoomStore.setState({ zoomLevel: 100 })
      await useZoomStore.getState().zoomOut()
      expect(useZoomStore.getState().zoomLevel).toBe(90)
      expect(appliedZoom()).toEqual({ label: 'main', value: 0.9 })
    })

    it('no-op at min level', async () => {
      ipc.override('set_setting', () => null)
      const min = ZOOM_LEVELS[0]
      useZoomStore.setState({ zoomLevel: min })
      await useZoomStore.getState().zoomOut()
      expect(useZoomStore.getState().zoomLevel).toBe(min)
      expect(ipc.calls('set_setting')).toHaveLength(0)
    })
  })

  describe('resetZoom', () => {
    it('resets to 100 and persists', async () => {
      ipc.override('set_setting', () => null)
      useZoomStore.setState({ zoomLevel: 150 })
      await useZoomStore.getState().resetZoom()
      expect(useZoomStore.getState().zoomLevel).toBe(100)
      expect(appliedZoom()).toEqual({ label: 'main', value: 1 })
      const calls = ipc.calls('set_setting')
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ key: 'appearance.zoom', value: '100' })
    })
  })

  describe('stepping through levels', () => {
    it('steps through all levels in order via zoomIn', async () => {
      ipc.override('set_setting', () => null)
      useZoomStore.setState({ zoomLevel: ZOOM_LEVELS[0] })
      const visited: number[] = [ZOOM_LEVELS[0]]
      for (let i = 1; i < ZOOM_LEVELS.length; i++) {
        await useZoomStore.getState().zoomIn()
        visited.push(useZoomStore.getState().zoomLevel)
      }
      expect(visited).toEqual([...ZOOM_LEVELS])
    })
  })
})
