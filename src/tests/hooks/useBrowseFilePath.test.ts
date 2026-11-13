import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useBrowseFilePath } from '../../hooks/useBrowseFilePath'
import { ipc } from '../ipc-mock'

const SAVE_REQUEST = { defaultPath: 'dump.sql', filterName: 'SQL files', extension: 'sql' }

describe('useBrowseFilePath', () => {
  it('starts with an empty path that can be typed', () => {
    const { result } = renderHook(() => useBrowseFilePath('test-dialog'))

    expect(result.current.filePath).toBe('')

    act(() => result.current.setFilePath('/tmp/typed.sql'))

    expect(result.current.filePath).toBe('/tmp/typed.sql')
  })

  it('stores the path chosen in the save dialog', async () => {
    ipc.override('plugin:dialog|save', () => '/tmp/chosen.sql')
    const { result } = renderHook(() => useBrowseFilePath('test-dialog'))

    await act(async () => {
      await result.current.browseForFilePath(SAVE_REQUEST)
    })

    expect(result.current.filePath).toBe('/tmp/chosen.sql')
    expect(ipc.calls('plugin:dialog|save')).toHaveLength(1)
  })

  it('keeps the current path when the dialog is dismissed', async () => {
    const { result } = renderHook(() => useBrowseFilePath('test-dialog'))
    act(() => result.current.setFilePath('/tmp/kept.sql'))

    await act(async () => {
      await result.current.browseForFilePath(SAVE_REQUEST)
    })

    expect(result.current.filePath).toBe('/tmp/kept.sql')
  })

  it('logs when the save dialog is unavailable', async () => {
    ipc.override('plugin:dialog|save', () => {
      throw new Error('no dialog')
    })
    const { result } = renderHook(() => useBrowseFilePath('test-dialog'))

    await act(async () => {
      await result.current.browseForFilePath(SAVE_REQUEST)
    })

    expect(ipc.payloads('log_frontend')).toContainEqual({
      level: 'info',
      message: expect.stringContaining('[test-dialog] Save dialog unavailable:'),
    })
  })
})
