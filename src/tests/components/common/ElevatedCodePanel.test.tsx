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
    expect(root).toHaveAttribute('data-variant', 'ring')
    expect(screen.getByText('DDL').parentElement).toHaveAttribute('data-variant', 'table')
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()

    const code = root.querySelector('pre code')
    expect(code?.textContent).toContain('SELECT 1')
  })

  it('renders the strip header variant', () => {
    render(
      <ElevatedCodePanel label="DDL" headerVariant="strip">
        <span>y</span>
      </ElevatedCodePanel>
    )

    expect(screen.getByText('DDL').parentElement).toHaveAttribute('data-variant', 'strip')
  })

  it('omits actions wrapper when headerActions is absent', () => {
    render(
      <ElevatedCodePanel label="X">
        <span>y</span>
      </ElevatedCodePanel>
    )

    expect(screen.getByText('X').nextElementSibling).toBeNull()
  })

  it('can reuse the shared code shell without rendering a header row', () => {
    render(
      <ElevatedCodePanel data-testid="code-panel" label="Hidden" hideHeader={true}>
        <span>SELECT 1</span>
      </ElevatedCodePanel>
    )

    const root = screen.getByTestId('code-panel')
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
    expect(root.querySelector('pre code')?.textContent).toContain('SELECT 1')
  })
})
