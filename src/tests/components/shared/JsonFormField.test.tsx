import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as MonacoEditorReactModule from '@monaco-editor/react'
import { JsonFormField } from '../../../components/shared/JsonFormField'
import { useThemeStore } from '../../../stores/theme-store'

const mockDefineTheme = vi.fn()
const mockSetTheme = vi.fn()
const mockEditorComponent = vi.fn()
const mockMountCount = vi.fn()

function createMonacoEditorMock() {
  return (props: Record<string, unknown>) => {
    mockEditorComponent(props)
    const [value, setValue] = useState(
      ((props.value as string | undefined) ?? (props.defaultValue as string | undefined) ?? '')
    )
    const valueRef = useRef(value)

    useEffect(() => {
      valueRef.current = value
    }, [value])

    useEffect(() => {
      if ('value' in props) {
        setValue((props.value as string | undefined) ?? '')
      }
    }, [props])

    useEffect(() => {
      mockMountCount()
    }, [])

    return (
      <textarea
        data-testid="monaco-editor"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          const onChange = props.onChange as ((value: string | undefined) => void) | undefined
          onChange?.(e.target.value)
        }}
        ref={() => {
          const onMount = props.onMount as
            | ((editor: unknown, monaco: Record<string, unknown>) => void)
            | undefined
          onMount?.(
            {
              getValue: () => valueRef.current,
              setValue: (nextValue: string) => {
                valueRef.current = nextValue
                setValue(nextValue)
              },
              addCommand: vi.fn(),
            },
            {
              editor: {
                defineTheme: mockDefineTheme,
                setTheme: mockSetTheme,
              },
              KeyCode: { F1: 59 },
            }
          )
        }}
      />
    )
  }
}

describe('JsonFormField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.setAttribute('data-theme', 'dark')
    useThemeStore.setState({ theme: 'dark', resolvedTheme: 'dark', _previewSnapshot: null })
    vi.spyOn(MonacoEditorReactModule, 'default').mockImplementation(createMonacoEditorMock())
  })

  it('renders pretty-printed syntax-highlighted JSON in read mode', () => {
    render(<JsonFormField value='{"name":"Ada","age":42}' isEditable={false} isNull={false} onChange={vi.fn()} />)

    const field = screen.getByTestId('json-form-field')
    expect(screen.getByTestId('json-form-field-panel')).toHaveClass('ui-elevated-surface')
    expect(field.textContent).toContain('{\n  "name": "Ada",\n  "age": 42\n}')
    expect(field.querySelector('.key')?.textContent).toBe('"name"')
    expect(field.querySelector('.string')?.textContent).toBe('"Ada"')
    expect(field.querySelector('.number')?.textContent).toBe('42')
  })

  it('renders NULL text in read mode when the field is null', () => {
    render(<JsonFormField value={null} isEditable={false} isNull={true} onChange={vi.fn()} />)
    expect(screen.getByTestId('json-form-field')).toHaveTextContent('NULL')
    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument()
  })

  it('renders an inline Monaco editor with a pretty-printed value in edit mode', () => {
    render(<JsonFormField value='{"a":1}' isEditable={true} isNull={false} onChange={vi.fn()} />)

    expect(screen.getByTestId('monaco-editor')).toHaveValue('{\n  "a": 1\n}')
    expect(mockDefineTheme).toHaveBeenCalledWith('precision-studio-dark', expect.any(Object))
  })

  it('does not emit a change from auto-pretty-print alone', () => {
    const onChange = vi.fn()
    render(<JsonFormField value='{"a":1}' isEditable={true} isNull={false} onChange={onChange} />)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('normalizes whitespace-only edits back to the original value', async () => {
    const onChange = vi.fn()
    render(<JsonFormField value='{"a":1}' isEditable={true} isNull={false} onChange={onChange} />)

    const editor = screen.getByTestId('monaco-editor') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: '{ "a": 1 }' } })

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('{"a":1}')
    })
  })

  it('emits semantically changed JSON synchronously while typing', async () => {
    const onChange = vi.fn()
    render(<JsonFormField value='{"a":1}' isEditable={true} isNull={false} onChange={onChange} />)

    const editor = screen.getByTestId('monaco-editor') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: '{\n  "a": 2\n}' } })

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('{\n  "a": 2\n}')
    })
  })

  it('does not remount or reset during debounced parent echoes while typing', async () => {
    function Harness() {
      const [value, setValue] = useState('{"a":1}')
      return (
        <JsonFormField value={value} isEditable={true} isNull={false} onChange={setValue} />
      )
    }

    render(<Harness />)

    const editor = screen.getByTestId('monaco-editor') as HTMLTextAreaElement
    expect(mockMountCount).toHaveBeenCalledTimes(1)

    fireEvent.change(editor, { target: { value: '{\n  "a": 12' } })

    await waitFor(() => {
      expect(editor).toHaveValue('{\n  "a": 12')
    })
    expect(mockMountCount).toHaveBeenCalledTimes(1)
  })

  it('handles controlled parent echoes without triggering an update loop', async () => {
    function Harness() {
      const [value, setValue] = useState('{"a":1}')
      return (
        <JsonFormField value={value} isEditable={true} isNull={false} onChange={setValue} />
      )
    }

    render(<Harness />)

    const editor = screen.getByTestId('monaco-editor') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: '{\n  "a": 3\n}' } })

    await waitFor(() => {
      expect(screen.getByTestId('monaco-editor')).toHaveValue('{\n  "a": 3\n}')
    })
    expect(mockMountCount).toHaveBeenCalledTimes(1)
  })

  it('flushes the latest edit before a parent save can read state', async () => {
    const onChange = vi.fn()
    render(<JsonFormField value='{"a":1}' isEditable={true} isNull={false} onChange={onChange} />)

    fireEvent.change(screen.getByTestId('monaco-editor'), {
      target: { value: '{\n  "a": 99\n}' },
    })

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith('{\n  "a": 99\n}')
    })
  })

  it('resyncs the editor when a true external value change arrives', async () => {
    const { rerender } = render(
      <JsonFormField value='{"a":1}' isEditable={true} isNull={false} onChange={vi.fn()} />
    )

    const editor = screen.getByTestId('monaco-editor') as HTMLTextAreaElement
    act(() => {
      fireEvent.change(editor, { target: { value: '{\n  "a": 12' } })
    })
    expect(editor).toHaveValue('{\n  "a": 12')

    rerender(<JsonFormField value='{"b":2}' isEditable={true} isNull={false} onChange={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByTestId('monaco-editor')).toHaveValue('{\n  "b": 2\n}')
    })
    expect(mockMountCount).toHaveBeenCalledTimes(1)
  })

  it('renders NULL text instead of Monaco in edit mode when the field is null', () => {
    render(<JsonFormField value={null} isEditable={true} isNull={true} onChange={vi.fn()} />)
    expect(screen.getByTestId('json-form-field')).toHaveTextContent('NULL')
    expect(screen.queryByTestId('monaco-editor')).not.toBeInTheDocument()
  })

  it('updates the Monaco theme when the app theme changes', async () => {
    render(<JsonFormField value='{"a":1}' isEditable={true} isNull={false} onChange={vi.fn()} />)

    act(() => {
      useThemeStore.setState({ theme: 'light', resolvedTheme: 'light', _previewSnapshot: null })
    })

    await waitFor(() => {
      expect(mockSetTheme).toHaveBeenCalledWith('precision-studio-light')
    })
  })
})
