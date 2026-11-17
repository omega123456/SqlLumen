import { describe, expect, it } from 'vitest'
import { isAiLockStatus, isEditorLockStatus } from '../../lib/query-tab-status'

describe('isAiLockStatus', () => {
  it('is true for the AI pending and reviewing statuses', () => {
    expect(isAiLockStatus('ai-pending')).toBe(true)
    expect(isAiLockStatus('ai-reviewing')).toBe(true)
  })
})

describe('isEditorLockStatus', () => {
  it('is true while running or AI locked', () => {
    expect(isEditorLockStatus('running')).toBe(true)
    expect(isEditorLockStatus('ai-pending')).toBe(true)
    expect(isEditorLockStatus('ai-reviewing')).toBe(true)
  })
})
