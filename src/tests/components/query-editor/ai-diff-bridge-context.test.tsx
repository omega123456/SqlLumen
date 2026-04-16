import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  AiDiffBridgeProvider,
  useRegisterAiDiffHandler,
  useAiDiffTrigger,
} from '../../../components/query-editor/ai-diff-bridge-context'

describe('AiDiffBridgeProvider', () => {
  it('invokes the registered handler when trigger is called', async () => {
    const handler = vi.fn()
    const range = {
      startLineNumber: 1,
      endLineNumber: 1,
      startColumn: 1,
      endColumn: 5,
    }

    function Inner() {
      const trigger = useAiDiffTrigger()
      useRegisterAiDiffHandler('t1', handler)
      return (
        <button
          type="button"
          data-testid="go"
          onClick={() => {
            trigger('t1', 'SELECT 1', range)
          }}
        >
          go
        </button>
      )
    }

    const user = userEvent.setup()
    render(
      <AiDiffBridgeProvider>
        <Inner />
      </AiDiffBridgeProvider>
    )

    await user.click(screen.getByTestId('go'))
    expect(handler).toHaveBeenCalledWith('SELECT 1', range)
  })
})
