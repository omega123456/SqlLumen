import { describe, expect, it } from 'vitest'
import { patchAiTab, putAiTab, removeAiTab } from '../../../stores/ai-store/ai-tab-reducers'
import { makeAiTabState } from '../../helpers/ai-test-utils'

describe('ai tab reducers', () => {
  it('puts a tab', () => {
    const tab = makeAiTabState()
    expect(putAiTab({ tabs: {} }, { tabId: 'tab-1', tab: tab }).tabs['tab-1']).toBe(tab)
  })

  it('patches an existing tab without touching the fallback', () => {
    const state = { tabs: { 'tab-1': makeAiTabState({ error: 'boom' }) } }
    const patched = patchAiTab(state, {
      tabId: 'tab-1',
      partial: { isPanelOpen: true },
      fallbackTab: makeAiTabState(),
    })
    expect(patched.tabs['tab-1']).toMatchObject({ isPanelOpen: true, error: 'boom' })
  })

  it('seeds a missing tab from the fallback before patching', () => {
    const patched = patchAiTab(
      { tabs: {} },
      { tabId: 'tab-1', partial: { isGenerating: true }, fallbackTab: makeAiTabState() }
    )
    expect(patched.tabs['tab-1']).toEqual(makeAiTabState({ isGenerating: true }))
  })

  it('removes a tab', () => {
    const state = { tabs: { 'tab-1': makeAiTabState(), 'tab-2': makeAiTabState() } }
    expect(Object.keys(removeAiTab(state, 'tab-1').tabs)).toEqual(['tab-2'])
  })
})
