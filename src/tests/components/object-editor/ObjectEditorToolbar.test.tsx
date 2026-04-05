import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  ObjectEditorToolbar,
  OBJECT_TYPE_LABELS,
} from '../../../components/object-editor/ObjectEditorToolbar'
import type { EditableObjectType } from '../../../types/schema'

function renderToolbar(overrides: Partial<Parameters<typeof ObjectEditorToolbar>[0]> = {}) {
  const defaultProps = {
    objectType: 'procedure' as EditableObjectType,
    objectName: 'my_proc',
    databaseName: 'app_db',
    mode: 'alter' as const,
    isSaving: false,
    isDirty: false,
    onSave: vi.fn(),
    ...overrides,
  }
  return { ...render(<ObjectEditorToolbar {...defaultProps} />), props: defaultProps }
}

describe('ObjectEditorToolbar', () => {
  it('renders correct label in alter mode (TypeLabel: objectName)', () => {
    renderToolbar({ objectType: 'procedure', objectName: 'my_proc', mode: 'alter' })
    expect(screen.getByText('Stored Procedure: my_proc')).toBeInTheDocument()
  })

  it('renders correct label in create mode (New TypeLabel)', () => {
    renderToolbar({ objectType: 'procedure', mode: 'create' })
    expect(screen.getByText('New Stored Procedure')).toBeInTheDocument()
  })

  it('renders database name below the title', () => {
    renderToolbar({ databaseName: 'test_db' })
    expect(screen.getByText('test_db')).toBeInTheDocument()
  })

  it('save button disabled when not dirty', () => {
    renderToolbar({ isDirty: false })
    expect(screen.getByTestId('object-editor-save-button')).toBeDisabled()
  })

  it('save button enabled when dirty', () => {
    renderToolbar({ isDirty: true })
    expect(screen.getByTestId('object-editor-save-button')).toBeEnabled()
  })

  it('save button disabled when saving', () => {
    renderToolbar({ isDirty: true, isSaving: true })
    expect(screen.getByTestId('object-editor-save-button')).toBeDisabled()
  })

  it('save button shows "Saving..." while saving', () => {
    renderToolbar({ isSaving: true })
    expect(screen.getByTestId('object-editor-save-button')).toHaveTextContent('Saving...')
  })

  it('save button shows "Save" when idle', () => {
    renderToolbar({ isSaving: false })
    expect(screen.getByTestId('object-editor-save-button')).toHaveTextContent('Save')
  })

  it('calls onSave when save button clicked', async () => {
    const user = userEvent.setup()
    const { props } = renderToolbar({ isDirty: true })

    await user.click(screen.getByTestId('object-editor-save-button'))
    expect(props.onSave).toHaveBeenCalledTimes(1)
  })

  it('renders toolbar data-testid', () => {
    renderToolbar()
    expect(screen.getByTestId('object-editor-toolbar')).toBeInTheDocument()
  })

  // Test all 5 object types render correctly
  const objectTypes: EditableObjectType[] = ['procedure', 'function', 'trigger', 'event', 'view']

  for (const objectType of objectTypes) {
    it(`renders correct label for ${objectType} in alter mode`, () => {
      renderToolbar({ objectType, objectName: 'test_obj', mode: 'alter' })
      expect(screen.getByText(`${OBJECT_TYPE_LABELS[objectType]}: test_obj`)).toBeInTheDocument()
    })

    it(`renders correct label for ${objectType} in create mode`, () => {
      renderToolbar({ objectType, mode: 'create' })
      expect(screen.getByText(`New ${OBJECT_TYPE_LABELS[objectType]}`)).toBeInTheDocument()
    })
  }
})
