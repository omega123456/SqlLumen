import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { type ComponentProps, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore } from '../../../stores/theme-store'
import JsonCellEditor from '../../../components/shared/JsonCellEditor'

const mockDefineTheme = vi.fn()
const mockSetTheme = vi.fn()
const mockFocus = vi.fn()
const mockDisposeBlur = vi.fn()
const mockObserve = vi.fn()
const mockDisconnect = vi.fn()

let blurHandler: (() => void) | null = null
let mutationObserverCallback: MutationCallback | null = null

class MockMutationObserver {
  constructor(callback: MutationCallback) {
    mutationObserverCallback = callback
  }

  observe = mockObserve
  disconnect = mockDisconnect
}

vi.mock('@monaco-editor/react', async () => {
  const React = await import('react')

  function MockMonacoEditor(props: Record<string, unknown>) {
    React.useEffect(() => {
      const onMount = props.onMount as ((editor: unknown, monaco: unknown) => void) | undefined
      if (!onMount) {
        return
      }

      const editor = {
        focus: mockFocus,
        onDidBlurEditorWidget: (cb: () => void) => {
          blurHandler = cb
          return {
            dispose: mockDisposeBlur,
          }
        },
      }
      const monaco = {
        editor: {
          defineTheme: mockDefineTheme,
          setTheme: mockSetTheme,
        },
      }

      onMount(editor, monaco)
    }, [props.onMount])

    return React.createElement('textarea', {
      'data-testid': 'json-monaco',
      value: (props.value as string) ?? '',
      onChange: (event: { target: { value: string } }) => {
        const fn = props.onChange as ((value: string | undefined) => void) | undefined
        fn?.(event.target.value)
      },
      onBlur: () => {
        blurHandler?.()
      },
    })
  }

  return {
    default: MockMonacoEditor,
  }
})

function renderEditor(
  overrides: Partial<ComponentProps<typeof JsonCellEditor>> = {}
): ComponentProps<typeof JsonCellEditor> {
  const props: ComponentProps<typeof JsonCellEditor> = {
    row: { payload: '{"alpha":1}' },
    column: { key: 'payload' },
    onRowChange: vi.fn(),
    onClose: vi.fn(),
    isNullable: true,
    tabId: 'tab-1',
    updateCellValue: vi.fn(),
    syncCellValue: vi.fn(),
    ...overrides,
  }

  render(<JsonCellEditor {...props} />)
  return props
}

describe('JsonCellEditor', () => {
  beforeEach(() => {
    blurHandler = null
    mutationObserverCallback = null
    mockDefineTheme.mockClear()
    mockSetTheme.mockClear()
    mockFocus.mockClear()
    mockDisposeBlur.mockClear()
    mockObserve.mockClear()
    mockDisconnect.mockClear()
    vi.stubGlobal('MutationObserver', MockMutationObserver)
    useThemeStore.setState({ theme: 'light', resolvedTheme: 'light', _previewSnapshot: null })
    document.documentElement.setAttribute('data-theme', 'light')
  })

  it('pretty-prints the initial value and registers Monaco themes on mount', async () => {
    renderEditor()

    expect(screen.getByTestId('json-monaco')).toHaveValue('{\n  "alpha": 1\n}')
    expect(mockDefineTheme).toHaveBeenCalledTimes(2)
    expect(mockSetTheme).toHaveBeenCalledWith('precision-studio-light')
    expect(mockFocus).toHaveBeenCalled()
  })

  it('preserves the original string when blur only normalizes whitespace', async () => {
    const props = renderEditor({
      row: { payload: '{"alpha":1,"beta":{"ok":true}}' },
    })

    fireEvent.blur(screen.getByTestId('json-monaco'))

    await waitFor(() => {
      expect(props.onRowChange).toHaveBeenCalledWith(
        { payload: '{"alpha":1,"beta":{"ok":true}}' },
        true
      )
    })
    expect(props.updateCellValue).toHaveBeenCalledWith(
      'tab-1',
      'payload',
      '{"alpha":1,"beta":{"ok":true}}'
    )
    expect(props.onClose).toHaveBeenCalledWith(true, false)
  })

  it('cancels edits on Escape and restores the original value', async () => {
    const props = renderEditor()

    fireEvent.change(screen.getByTestId('json-monaco'), {
      target: { value: '{\n  "alpha": 2\n}' },
    })
    fireEvent.keyDown(screen.getByTestId('json-monaco'), { key: 'Escape' })

    await waitFor(() => {
      expect(props.onRowChange).toHaveBeenCalledWith({ payload: '{"alpha":1}' }, false)
    })
    expect(props.updateCellValue).toHaveBeenCalledWith('tab-1', 'payload', '{"alpha":1}')
    expect(props.onClose).toHaveBeenCalledWith(false, false)
  })

  it('pushes draft edits through onRowChange and store sync while typing', async () => {
    const props = renderEditor()

    fireEvent.change(screen.getByTestId('json-monaco'), {
      target: { value: '{\n  "alpha": 2\n}' },
    })

    await waitFor(() => {
      expect(props.onRowChange).toHaveBeenCalledWith({ payload: '{\n  "alpha": 2\n}' })
    })
    expect(props.updateCellValue).toHaveBeenCalledWith('tab-1', 'payload', '{\n  "alpha": 2\n}')
    expect(props.syncCellValue).toHaveBeenCalledWith(
      'tab-1',
      { payload: '{"alpha":1}' },
      'payload',
      '{\n  "alpha": 2\n}'
    )
  })

  it('commits the latest draft value after it has already synced during editing', async () => {
    const onRowChange = vi.fn()
    const onClose = vi.fn()
    const updateCellValue = vi.fn()
    const syncCellValue = vi.fn()

    function Harness() {
      const [row, setRow] = useState<Record<string, unknown>>({ payload: '{"alpha":1}' })

      return (
        <JsonCellEditor
          row={row}
          column={{ key: 'payload' }}
          onRowChange={(nextRow, commitChanges) => {
            onRowChange(nextRow, commitChanges)
            setRow(nextRow)
          }}
          onClose={onClose}
          isNullable
          tabId="tab-1"
          updateCellValue={updateCellValue}
          syncCellValue={syncCellValue}
        />
      )
    }

    render(<Harness />)

    fireEvent.change(screen.getByTestId('json-monaco'), {
      target: { value: '{\n  "alpha": 2\n}' },
    })

    await waitFor(() => {
      expect(onRowChange).toHaveBeenCalledWith({ payload: '{\n  "alpha": 2\n}' }, undefined)
    })

    fireEvent.blur(screen.getByTestId('json-monaco'))

    await waitFor(() => {
      expect(onRowChange).toHaveBeenLastCalledWith({ payload: '{\n  "alpha": 2\n}' }, true)
    })
    expect(updateCellValue).toHaveBeenLastCalledWith('tab-1', 'payload', '{\n  "alpha": 2\n}')
    expect(onClose).toHaveBeenCalledWith(true, false)
  })

  it('does not commit on plain Enter so Monaco can keep multiline editing', () => {
    const props = renderEditor()

    fireEvent.change(screen.getByTestId('json-monaco'), {
      target: { value: '{\n  "alpha": 2\n}' },
    })
    fireEvent.keyDown(screen.getByTestId('json-monaco'), { key: 'Enter' })

    expect(props.onRowChange).toHaveBeenCalledWith({ payload: '{\n  "alpha": 2\n}' })
    expect(props.updateCellValue).toHaveBeenCalledWith('tab-1', 'payload', '{\n  "alpha": 2\n}')
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('commits the edited value on Mod+Enter and returns focus to the grid', async () => {
    const props = renderEditor()

    fireEvent.change(screen.getByTestId('json-monaco'), {
      target: { value: '{\n  "alpha": 2\n}' },
    })
    fireEvent.keyDown(screen.getByTestId('json-monaco'), { key: 'Enter', ctrlKey: true })

    await waitFor(() => {
      expect(props.onRowChange).toHaveBeenCalledWith({ payload: '{\n  "alpha": 2\n}' }, true)
    })
    expect(props.updateCellValue).toHaveBeenCalledWith('tab-1', 'payload', '{\n  "alpha": 2\n}')
    expect(props.onClose).toHaveBeenCalledWith(true, true)
  })

  it('does not commit on Tab so Monaco can keep indentation behavior', () => {
    const props = renderEditor()

    fireEvent.change(screen.getByTestId('json-monaco'), {
      target: { value: '{\n  "alpha": 2\n}' },
    })
    fireEvent.keyDown(screen.getByTestId('json-monaco'), { key: 'Tab' })

    expect(props.onRowChange).toHaveBeenCalledWith({ payload: '{\n  "alpha": 2\n}' })
    expect(props.updateCellValue).toHaveBeenCalledWith('tab-1', 'payload', '{\n  "alpha": 2\n}')
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('toggles nullable JSON values to NULL and back to the pretty-printed original', async () => {
    const props = renderEditor()

    fireEvent.click(screen.getByRole('button', { name: 'NULL' }))

    await waitFor(() => {
      expect(props.onRowChange).toHaveBeenCalledWith({ payload: null })
    })
    expect(props.updateCellValue).toHaveBeenCalledWith('tab-1', 'payload', null)
    expect(screen.getByTestId('json-cell-editor-surface')).toHaveTextContent('NULL')

    fireEvent.click(screen.getByRole('button', { name: 'NULL' }))

    await waitFor(() => {
      expect(props.onRowChange).toHaveBeenLastCalledWith({ payload: '{\n  "alpha": 1\n}' })
    })
    expect(props.updateCellValue).toHaveBeenLastCalledWith('tab-1', 'payload', '{\n  "alpha": 1\n}')
  })

  it('toggles null JSON values back to a valid default object', async () => {
    const props = renderEditor({
      row: { payload: null },
      cancelRestoreValue: null,
    })

    fireEvent.click(screen.getByRole('button', { name: 'NULL' }))

    await waitFor(() => {
      expect(props.onRowChange).toHaveBeenCalledWith({ payload: '{}' })
    })
    expect(props.updateCellValue).toHaveBeenCalledWith('tab-1', 'payload', '{}')
  })

  it('honors the typing activation seed for initial input', () => {
    renderEditor({
      row: { payload: '{"alpha":1}' },
      initialInputValue: '{',
      selectAllOnFocus: false,
    })

    expect(screen.getByTestId('json-monaco')).toHaveValue('{')
  })

  it('updates the Monaco theme when the document theme attribute changes', async () => {
    renderEditor()

    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'dark')
      mutationObserverCallback?.([], {} as MutationObserver)
    })

    await waitFor(() => {
      expect(mockSetTheme).toHaveBeenCalledWith('precision-studio-dark')
    })
  })
})
