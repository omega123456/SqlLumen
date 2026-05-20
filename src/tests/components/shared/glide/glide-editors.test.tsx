import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { GridCellKind, type TextCell } from '@glideapps/glide-data-grid'
import {
  computeRequestedEditorWidth,
  getGlideEditor,
  wrapEditorAsGlideOverlay,
} from '../../../../components/shared/glide/glide-editors'

type EditorConfig = { editor: ComponentType<Record<string, unknown>> } | null

describe('computeRequestedEditorWidth', () => {
  it('keeps the cell width when no markers are present', () => {
    expect(computeRequestedEditorWidth(80, 0)).toBe(80)
  })

  it('expands width to preserve a 2/3 field and 1/3 marker split', () => {
    expect(computeRequestedEditorWidth(38, 1)).toBe(152)
    expect(computeRequestedEditorWidth(80, 2)).toBe(204)
  })

  it('does not shrink already-wide cells', () => {
    expect(computeRequestedEditorWidth(240, 1)).toBe(240)
  })
})

describe('wrapEditorAsGlideOverlay', () => {
  it('passes the first typed character to the editor without publishing a Glide value change', () => {
    const onChange = vi.fn()
    const Editor = wrapEditorAsGlideOverlay(
      ({ initialInputValue }) => (
        <input aria-label="wrapped editor" readOnly value={initialInputValue ?? ''} />
      ),
      { testId: 'test-editor' }
    )

    const value: TextCell & {
      glideEditorData: {
        row: Record<string, unknown>
        columnKey: string
        isNullable: boolean
        initialInputValue: string
        selectAllOnFocus: boolean
      }
    } = {
      kind: GridCellKind.Text,
      data: 'alpha',
      displayData: 'alpha',
      copyData: 'alpha',
      allowOverlay: true,
      readonly: false,
      glideEditorData: {
        row: { name: 'alpha' },
        columnKey: 'name',
        isNullable: true,
        initialInputValue: 'x',
        selectAllOnFocus: false,
      },
    }

    render(
      <Editor
        target={{ x: 0, y: 0, width: 80, height: 32 }}
        value={value}
        onChange={onChange}
        onFinishedEditing={vi.fn()}
      />
    )

    expect(screen.getByLabelText('wrapped editor')).toHaveValue('x')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not overwrite a typed value with the first-character seed before blur commit', () => {
    let changeRow: ((nextValue: string) => void) | null = null
    let closeEditor: (() => void) | null = null
    const onFinishedEditing = vi.fn()
    const Editor = wrapEditorAsGlideOverlay(
      ({ row, column, onRowChange, onClose }) => {
        changeRow = (nextValue: string) => onRowChange({ ...row, [column.key]: nextValue })
        closeEditor = () => onClose(true, false)
        return <input aria-label="wrapped editor" readOnly value={String(row[column.key] ?? '')} />
      },
      { testId: 'test-editor' }
    )

    const buildValue = (): TextCell & {
      glideEditorData: {
        row: Record<string, unknown>
        columnKey: string
        isNullable: boolean
        initialInputValue: string
        selectAllOnFocus: boolean
      }
    } => ({
      kind: GridCellKind.Text,
      data: 'alpha',
      displayData: 'alpha',
      copyData: 'alpha',
      allowOverlay: true,
      readonly: false,
      glideEditorData: {
        row: { name: 'alpha' },
        columnKey: 'name',
        isNullable: true,
        initialInputValue: '1',
        selectAllOnFocus: false,
      },
    })

    const { rerender } = render(
      <Editor
        target={{ x: 0, y: 0, width: 80, height: 32 }}
        value={buildValue()}
        onChange={vi.fn()}
        onFinishedEditing={onFinishedEditing}
      />
    )

    changeRow!('1234')
    rerender(
      <Editor
        target={{ x: 0, y: 0, width: 80, height: 32 }}
        value={buildValue()}
        onChange={vi.fn()}
        onFinishedEditing={onFinishedEditing}
      />
    )
    closeEditor!()

    expect(onFinishedEditing).toHaveBeenCalledWith(
      expect.objectContaining({ data: '1234', displayData: '1234', copyData: '1234' })
    )
  })

  it('passes the data column key to wrapped editors when the display label differs', () => {
    let setNull: (() => void) | null = null
    const onChange = vi.fn()
    const Editor = wrapEditorAsGlideOverlay(
      ({ row, column, onRowChange }) => {
        setNull = () => onRowChange({ ...row, [column.key]: null })
        return <button onClick={setNull}>NULL</button>
      },
      { testId: 'test-editor' }
    )

    render(
      <Editor
        target={{ x: 0, y: 0, width: 80, height: 32 }}
        value={
          {
            kind: GridCellKind.Text,
            data: '{"ok":true}',
            displayData: '{"ok":true}',
            copyData: '{"ok":true}',
            allowOverlay: true,
            readonly: false,
            glideEditorData: {
              row: { col_0: '{"ok":true}' },
              columnKey: 'col_0',
              columnLabel: 'profile',
              isNullable: true,
            },
          } as TextCell & { glideEditorData: Record<string, unknown> }
        }
        onChange={onChange}
        onFinishedEditing={vi.fn()}
      />
    )

    setNull!()

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ data: '', displayData: 'NULL', copyData: 'NULL' })
    )
  })

  it('writes overlay padding metadata when configured', () => {
    const Editor = wrapEditorAsGlideOverlay(() => null, {
      testId: 'test-editor',
      overlayExtraWidth: 0,
      reserveMarkerWidth: false,
    })

    const value: TextCell & {
      glideEditorData: {
        row: Record<string, unknown>
        columnKey: string
        isNullable: boolean
      }
    } = {
      kind: GridCellKind.Text,
      data: 'alpha',
      displayData: 'alpha',
      copyData: 'alpha',
      allowOverlay: true,
      readonly: false,
      glideEditorData: {
        row: { name: 'alpha' },
        columnKey: 'name',
        isNullable: true,
      },
    }

    const { getByTestId } = render(
      <Editor
        target={{ x: 0, y: 0, width: 80, height: 32 }}
        value={value}
        onChange={vi.fn()}
        onFinishedEditing={vi.fn()}
      />
    )

    expect(getByTestId('test-editor')).toHaveAttribute('data-sqllumen-editor-width', '80')
  })

  it('applies a minimum overlay width when configured', () => {
    const Editor = wrapEditorAsGlideOverlay(() => null, {
      testId: 'test-editor',
      overlayExtraWidth: 20,
      overlayMinWidth: 380,
      reserveMarkerWidth: false,
    })

    render(
      <Editor
        target={{ x: 0, y: 0, width: 120, height: 32 }}
        value={
          {
            kind: GridCellKind.Text,
            data: '{"ok":true}',
            displayData: '{"ok":true}',
            copyData: '{"ok":true}',
            allowOverlay: true,
            readonly: false,
            glideEditorData: {
              row: { payload: '{"ok":true}' },
              columnKey: 'payload',
              isNullable: true,
            },
          } as TextCell & { glideEditorData: Record<string, unknown> }
        }
        onChange={vi.fn()}
        onFinishedEditing={vi.fn()}
      />
    )

    expect(screen.getByTestId('test-editor')).toHaveStyle({ width: '380px', maxWidth: '380px' })
    expect(screen.getByTestId('test-editor')).toHaveAttribute('data-sqllumen-editor-width', '400')
  })

  it('uses a taller textarea overlay for MySQL long-text columns', () => {
    vi.stubGlobal('innerHeight', 900)
    const editorConfig = getGlideEditor(
      { key: 'notes', name: 'Notes', dataType: 'LONGTEXT' },
      'text'
    )

    expect(editorConfig).toMatchObject({
      editor: expect.any(Function),
    })

    const Editor = (editorConfig as EditorConfig)!.editor!
    expect(Editor).toBeDefined()

    render(
      <Editor
        target={{ x: 0, y: 0, width: 120, height: 32 }}
        value={
          {
            kind: GridCellKind.Text,
            data: 'alpha',
            displayData: 'alpha',
            copyData: 'alpha',
            allowOverlay: true,
            readonly: false,
            glideEditorData: {
              row: { notes: 'alpha' },
              columnKey: 'notes',
              isNullable: true,
            },
          } as TextCell & { glideEditorData: Record<string, unknown> }
        }
        onChange={vi.fn()}
        onFinishedEditing={vi.fn()}
      />
    )

    expect(screen.getByTestId('glide-textarea-editor')).toHaveStyle({ height: '450px' })
    expect(screen.getByRole('textbox')).toHaveAttribute('rows', '6')
  })

  it('caps multiline overlay height at 500px', () => {
    vi.stubGlobal('innerHeight', 1400)
    const editorConfig = getGlideEditor(
      { key: 'notes', name: 'Notes', dataType: 'LONGTEXT' },
      'text'
    )
    const Editor = (editorConfig as EditorConfig)!.editor!

    render(
      <Editor
        target={{ x: 0, y: 0, width: 120, height: 32 }}
        value={
          {
            kind: GridCellKind.Text,
            data: 'alpha',
            displayData: 'alpha',
            copyData: 'alpha',
            allowOverlay: true,
            readonly: false,
            glideEditorData: {
              row: { notes: 'alpha' },
              columnKey: 'notes',
              isNullable: true,
            },
          } as TextCell & { glideEditorData: Record<string, unknown> }
        }
        onChange={vi.fn()}
        onFinishedEditing={vi.fn()}
      />
    )

    expect(screen.getByTestId('glide-textarea-editor')).toHaveStyle({ height: '500px' })
  })

  it('routes json editor types to the dedicated overlay shell', () => {
    vi.stubGlobal('innerHeight', 1200)
    const editorConfig = getGlideEditor(
      { key: 'payload', name: 'Payload', dataType: 'JSON' },
      'json'
    )
    const Editor = (editorConfig as EditorConfig)!.editor!

    render(
      <Editor
        target={{ x: 0, y: 0, width: 120, height: 32 }}
        value={
          {
            kind: GridCellKind.Text,
            data: '{"ok":true}',
            displayData: '{"ok":true}',
            copyData: '{"ok":true}',
            allowOverlay: true,
            readonly: false,
            glideEditorData: {
              row: { payload: '{"ok":true}' },
              columnKey: 'payload',
              isNullable: true,
            },
          } as TextCell & { glideEditorData: Record<string, unknown> }
        }
        onChange={vi.fn()}
        onFinishedEditing={vi.fn()}
      />
    )

    expect(screen.getByTestId('glide-json-editor')).toBeInTheDocument()
    expect(screen.getByTestId('glide-json-editor')).toHaveStyle({
      width: '380px',
      height: '400px',
    })
  })

  it('commits multiline editors on Enter and keeps Shift+Enter for new lines', () => {
    const editorConfig = getGlideEditor(
      { key: 'notes', name: 'Notes', dataType: 'MEDIUMTEXT' },
      'text'
    )
    const Editor = (editorConfig as EditorConfig)!.editor!
    const onFinishedEditing = vi.fn()

    render(
      <Editor
        target={{ x: 0, y: 0, width: 120, height: 32 }}
        value={
          {
            kind: GridCellKind.Text,
            data: 'alpha',
            displayData: 'alpha',
            copyData: 'alpha',
            allowOverlay: true,
            readonly: false,
            glideEditorData: {
              row: { notes: 'alpha' },
              columnKey: 'notes',
              isNullable: true,
            },
          } as TextCell & { glideEditorData: Record<string, unknown> }
        }
        onChange={vi.fn()}
        onFinishedEditing={onFinishedEditing}
      />
    )

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'alpha\nbeta' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(onFinishedEditing).not.toHaveBeenCalled()
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onFinishedEditing).toHaveBeenCalledWith(
      expect.objectContaining({ data: 'alpha\nbeta', displayData: 'alpha\nbeta' })
    )
  })
})
