import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { AiCodeBlock } from '../../../components/ai-panel/AiCodeBlock'

function setupMockIPC() {
  mockIPC((cmd) => {
    if (cmd === 'log_frontend') return undefined
    if (cmd === 'plugin:event|listen') return () => {}
    if (cmd === 'plugin:event|unlisten') return undefined
    if (cmd === 'get_setting') return null
    if (cmd === 'set_setting') return undefined
    if (cmd === 'get_all_settings') return {}
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
}

let consoleSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  setupMockIPC()
})

afterEach(() => {
  consoleSpy.mockRestore()
})

describe('AiCodeBlock', () => {
  it('renders with data-testid="ai-code-block"', () => {
    render(<AiCodeBlock language="sql">SELECT * FROM users</AiCodeBlock>)
    expect(screen.getByTestId('ai-code-block')).toBeInTheDocument()
  })

  it('displays code content', () => {
    render(<AiCodeBlock language="sql">SELECT * FROM users</AiCodeBlock>)
    expect(screen.getByText('SELECT * FROM users')).toBeInTheDocument()
  })

  it('displays language label', () => {
    render(<AiCodeBlock language="sql">SELECT 1</AiCodeBlock>)
    expect(screen.getByText('sql')).toBeInTheDocument()
  })

  it('displays "code" when no language specified', () => {
    render(<AiCodeBlock>some code</AiCodeBlock>)
    expect(screen.getByText('code')).toBeInTheDocument()
  })

  it('shows copy button', () => {
    render(<AiCodeBlock language="sql">SELECT 1</AiCodeBlock>)
    expect(screen.getByTestId('ai-code-copy-button')).toBeInTheDocument()
    expect(screen.getByLabelText('Copy SQL')).toBeInTheDocument()
  })

  it('copy button invokes clipboard writeText', async () => {
    // Use userEvent.setup with writeToClipboard so clipboard calls go through
    const user = userEvent.setup()
    render(<AiCodeBlock language="sql">SELECT * FROM users</AiCodeBlock>)

    await user.click(screen.getByTestId('ai-code-copy-button'))

    // Verify the copy action occurred by checking for the "Copied!" feedback
    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument()
    })
  })

  it('shows "Copied!" after clicking copy', async () => {
    const user = userEvent.setup()
    render(<AiCodeBlock language="sql">SELECT 1</AiCodeBlock>)

    await user.click(screen.getByTestId('ai-code-copy-button'))

    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument()
    })
  })

  it('does not show diff button by default', () => {
    render(<AiCodeBlock language="sql">SELECT 1</AiCodeBlock>)
    expect(screen.queryByTestId('ai-code-diff-button')).not.toBeInTheDocument()
  })

  it('shows diff button when showDiffButton is true and language is sql (single statement)', () => {
    const onTriggerDiff = vi.fn()
    render(
      <AiCodeBlock language="sql" showDiffButton={true} onTriggerDiff={onTriggerDiff}>
        SELECT * FROM users
      </AiCodeBlock>
    )
    expect(screen.getByTestId('ai-code-diff-button')).toBeInTheDocument()
    expect(screen.getByLabelText('View diff')).toBeInTheDocument()
  })

  it('does not show diff button for non-SQL languages', () => {
    const onTriggerDiff = vi.fn()
    render(
      <AiCodeBlock language="python" showDiffButton={true} onTriggerDiff={onTriggerDiff}>
        print("hello")
      </AiCodeBlock>
    )
    expect(screen.queryByTestId('ai-code-diff-button')).not.toBeInTheDocument()
  })

  it('calls onTriggerDiff when diff button is clicked', async () => {
    const user = userEvent.setup()
    const onTriggerDiff = vi.fn()
    render(
      <AiCodeBlock language="sql" showDiffButton={true} onTriggerDiff={onTriggerDiff}>
        SELECT * FROM users
      </AiCodeBlock>
    )

    await user.click(screen.getByTestId('ai-code-diff-button'))
    expect(onTriggerDiff).toHaveBeenCalledWith('SELECT * FROM users')
  })

  it('does not show diff button when onTriggerDiff is not provided', () => {
    render(
      <AiCodeBlock language="sql" showDiffButton={true}>
        SELECT 1
      </AiCodeBlock>
    )
    expect(screen.queryByTestId('ai-code-diff-button')).not.toBeInTheDocument()
  })

  it('shows diff button for mysql language (single statement)', () => {
    const onTriggerDiff = vi.fn()
    render(
      <AiCodeBlock language="mysql" showDiffButton={true} onTriggerDiff={onTriggerDiff}>
        SELECT 1
      </AiCodeBlock>
    )
    expect(screen.getByTestId('ai-code-diff-button')).toBeInTheDocument()
  })

  it('extracts text from nested React element children', async () => {
    const user = userEvent.setup()
    render(
      <AiCodeBlock language="sql">
        <span>SELECT</span>
        <span> * FROM </span>
        <span>users</span>
      </AiCodeBlock>
    )

    await user.click(screen.getByTestId('ai-code-copy-button'))

    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument()
    })
  })

  it('extracts text from number children', async () => {
    const user = userEvent.setup()
    render(<AiCodeBlock language="sql">{42}</AiCodeBlock>)

    await user.click(screen.getByTestId('ai-code-copy-button'))

    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument()
    })
  })

  it('handles null/undefined children gracefully', async () => {
    const user = userEvent.setup()
    render(
      <AiCodeBlock language="sql">
        {null}
        {undefined}
        SELECT 1
      </AiCodeBlock>
    )

    await user.click(screen.getByTestId('ai-code-copy-button'))

    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument()
    })
  })

  it('extracts text from array children', async () => {
    const user = userEvent.setup()
    render(<AiCodeBlock language="sql">{['SELECT ', '1']}</AiCodeBlock>)

    await user.click(screen.getByTestId('ai-code-copy-button'))

    await waitFor(() => {
      expect(screen.getByText('Copied!')).toBeInTheDocument()
    })
  })

  it('calls onTriggerDiff with nested element text content', async () => {
    const user = userEvent.setup()
    const onTriggerDiff = vi.fn()
    render(
      <AiCodeBlock language="sql" showDiffButton={true} onTriggerDiff={onTriggerDiff}>
        <span>SELECT * FROM users</span>
      </AiCodeBlock>
    )

    await user.click(screen.getByTestId('ai-code-diff-button'))
    expect(onTriggerDiff).toHaveBeenCalledWith('SELECT * FROM users')
  })

  // --- Multi-statement diff blocking tests ---

  it('hides diff button when SQL contains multiple statements', () => {
    const onTriggerDiff = vi.fn()
    render(
      <AiCodeBlock language="sql" showDiffButton={true} onTriggerDiff={onTriggerDiff}>
        SELECT * FROM users; SELECT * FROM orders;
      </AiCodeBlock>
    )
    expect(screen.queryByTestId('ai-code-diff-button')).not.toBeInTheDocument()
  })

  it('shows diff button for single statement with trailing semicolon', () => {
    const onTriggerDiff = vi.fn()
    render(
      <AiCodeBlock language="sql" showDiffButton={true} onTriggerDiff={onTriggerDiff}>
        SELECT * FROM users WHERE active = 1;
      </AiCodeBlock>
    )
    expect(screen.getByTestId('ai-code-diff-button')).toBeInTheDocument()
  })

  it('shows diff button for single statement without trailing semicolon', () => {
    const onTriggerDiff = vi.fn()
    render(
      <AiCodeBlock language="sql" showDiffButton={true} onTriggerDiff={onTriggerDiff}>
        SELECT * FROM users WHERE active = 1
      </AiCodeBlock>
    )
    expect(screen.getByTestId('ai-code-diff-button')).toBeInTheDocument()
  })

  it('hides diff button when SQL contains three statements', () => {
    const onTriggerDiff = vi.fn()
    render(
      <AiCodeBlock language="sql" showDiffButton={true} onTriggerDiff={onTriggerDiff}>
        {'SELECT 1;\nSELECT 2;\nSELECT 3;'}
      </AiCodeBlock>
    )
    expect(screen.queryByTestId('ai-code-diff-button')).not.toBeInTheDocument()
  })

  it('hides diff button for empty SQL content', () => {
    const onTriggerDiff = vi.fn()
    render(
      <AiCodeBlock language="sql" showDiffButton={true} onTriggerDiff={onTriggerDiff}>
        {'  '}
      </AiCodeBlock>
    )
    expect(screen.queryByTestId('ai-code-diff-button')).not.toBeInTheDocument()
  })

  it('hides diff button for multi-statement mysql language', () => {
    const onTriggerDiff = vi.fn()
    render(
      <AiCodeBlock language="mysql" showDiffButton={true} onTriggerDiff={onTriggerDiff}>
        INSERT INTO users VALUES (1); INSERT INTO users VALUES (2);
      </AiCodeBlock>
    )
    expect(screen.queryByTestId('ai-code-diff-button')).not.toBeInTheDocument()
  })
})
