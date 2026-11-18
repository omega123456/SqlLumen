import { describe, expect, it } from 'vitest'
import {
  initialOpenSections,
  isSectionDirty,
  restoreSection,
  sectionsWithErrors,
} from '../../../../components/connections-page/profile/profile-sections'
import { getDefaultFormData } from '../../../../components/connections-page/profile/connection-editor-state'

describe('profile sections', () => {
  it('opens Server, Sign-in and Name and behaviour for a new profile, nothing for an existing one', () => {
    expect(initialOpenSections(true)).toEqual(['server', 'signIn', 'behaviour'])
    expect(initialOpenSections(false)).toEqual([])
  })

  it('maps field errors to sections in page order and ignores unknown keys', () => {
    expect(sectionsWithErrors({ name: 'x', sslKeyPath: 'x', host: 'x', unknown: 'x' })).toEqual([
      'server',
      'security',
      'behaviour',
    ])
  })

  it('detects and restores changes one section at a time', () => {
    const baseline = getDefaultFormData()
    const current = { ...baseline, host: 'changed', name: 'renamed' }
    expect(isSectionDirty({ section: 'server', current: current, baseline: baseline })).toBe(true)
    expect(isSectionDirty({ section: 'security', current: current, baseline: baseline })).toBe(
      false
    )
    const restored = restoreSection({ section: 'server', current: current, baseline: baseline })
    expect(restored.host).toBe(baseline.host)
    expect(restored.name).toBe('renamed')
  })
})
