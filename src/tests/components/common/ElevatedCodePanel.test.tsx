import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ElevatedCodePanel } from '../../../components/common/ElevatedCodePanel'

describe('ElevatedCodePanel', () => {
  it('renders elevated shell, table-style header, and code body', () => {
    render(
      <ElevatedCodePanel
        data-testid="code-panel"
        label="DDL"
        headerActions={<button type="button">Copy</button>}
      >
        <span>SELECT 1</span>
      </ElevatedCodePanel>
    )

    const root = screen.getByTestId('code-panel')
    expect(root).toHaveClass('ui-elevated-surface')

    expect(root.querySelector('.ui-elevated-panel-header')).toBeTruthy()
    expect(root.querySelector('.ui-elevated-panel-header__label')).toHaveTextContent('DDL')

    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()

    const code = root.querySelector('pre code')
    expect(code?.textContent).toContain('SELECT 1')
  })

  it('omits actions wrapper when headerActions is absent', () => {
    const { container } = render(
      <ElevatedCodePanel label="X">
        <span>y</span>
      </ElevatedCodePanel>
    )

    expect(container.querySelector('.ui-elevated-panel-header__actions')).toBeNull()
  })

  it('can reuse the shared code shell without rendering a header row', () => {
    render(
      <ElevatedCodePanel data-testid="code-panel" hideHeader={true}>
        <span>SELECT 1</span>
      </ElevatedCodePanel>
    )

    const root = screen.getByTestId('code-panel')
    expect(root).toHaveClass('ui-elevated-surface')
    expect(root.querySelector('.ui-elevated-panel-header')).toBeNull()
    expect(root.querySelector('pre code')?.textContent).toContain('SELECT 1')
  })
})
