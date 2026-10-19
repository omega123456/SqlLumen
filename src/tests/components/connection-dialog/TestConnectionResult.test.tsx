import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TestConnectionResult } from '../../../components/connection-dialog/TestConnectionResult'

describe('TestConnectionResult', () => {
  it('renders nothing without a result', () => {
    const { container } = render(<TestConnectionResult result={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a success InfoBar with server details', () => {
    render(
      <TestConnectionResult
        result={{
          success: true,
          serverVersion: 'MySQL 8.0.33',
          authMethod: 'caching_sha2_password',
          sslStatus: 'disabled',
          connectionTimeMs: 24,
          errorMessage: null,
        }}
      />
    )
    const bar = screen.getByTestId('test-connection-result')
    expect(bar).toHaveAttribute('data-severity', 'success')
    expect(bar).toHaveAttribute('role', 'status')
    expect(bar).toHaveTextContent('Connected')
    expect(bar).toHaveTextContent('MySQL 8.0.33 in 24 ms')
    expect(bar).toHaveTextContent('Auth method caching_sha2_password · SSL disabled')
    expect(bar.querySelector('[aria-hidden="true"]')).toHaveTextContent('✓')
  })

  it('shows an error InfoBar with the failure message', () => {
    render(
      <TestConnectionResult
        result={{
          success: false,
          serverVersion: null,
          authMethod: null,
          sslStatus: null,
          connectionTimeMs: null,
          errorMessage: 'Access denied',
        }}
      />
    )
    const bar = screen.getByRole('alert')
    expect(bar).toHaveAttribute('data-severity', 'error')
    expect(bar).toHaveTextContent('Connection failed')
    expect(bar).toHaveTextContent('Access denied')
  })
})
