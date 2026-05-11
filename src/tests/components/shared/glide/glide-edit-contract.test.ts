import { describe, expect, it } from 'vitest'
import {
  EDIT_CONTRACT_GAPS,
  EDIT_CONTRACT_NATIVE_GLIDE_FEATURES,
} from '../../../../components/shared/glide/glide-edit-contract'
import type {
  ClipboardAction,
  EditEligibilityCheck,
  EditLifecycleEvent,
} from '../../../../components/shared/glide/glide-edit-contract'

describe('glide-edit-contract', () => {
  it('documents native Glide features and gaps', () => {
    expect(EDIT_CONTRACT_NATIVE_GLIDE_FEATURES.length).toBeGreaterThan(0)
    expect(EDIT_CONTRACT_GAPS.length).toBeGreaterThan(0)
  })
  it('keeps runtime type shapes stable', () => {
    const eligibility: EditEligibilityCheck = {
      isEditable: true,
      requiresAutosaveGuard: true,
      editorType: 'text',
    }
    const event: EditLifecycleEvent = {
      type: 'commit',
      rowIdx: 0,
      columnKey: 'name',
      value: 'x',
      source: 'enter',
    }
    const action: ClipboardAction = {
      type: 'paste',
      cells: [{ rowIdx: 0, columnKey: 'name', value: null }],
    }
    expect(eligibility.editorType).toBe('text')
    expect(event.type).toBe('commit')
    expect(action.type).toBe('paste')
  })
})
