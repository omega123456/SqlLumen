import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GridCellKind, type TextCell } from '@glideapps/glide-data-grid'
import {
  computeRequestedEditorWidth,
  wrapEditorAsGlideOverlay,
} from '../../../../components/shared/glide/glide-editors'

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
})
