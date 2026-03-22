import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DataTableContainer } from '../../../components/common/DataTableContainer'

describe('DataTableContainer', () => {
  it('wraps children in ui-elevated-surface when elevated (default)', () => {
    render(
      <DataTableContainer data-testid="scroll">
        <table>
          <tbody>
            <tr>
              <td>a</td>
            </tr>
          </tbody>
        </table>
      </DataTableContainer>
    )

    const scroll = screen.getByTestId('scroll')
    const outer = scroll.parentElement
    expect(outer).not.toBeNull()
    expect(outer).toHaveClass('ui-elevated-surface')
  })

  it('omits elevated shell when elevated={false}', () => {
    render(
      <DataTableContainer elevated={false} data-testid="scroll">
        <table>
          <tbody>
            <tr>
              <td>a</td>
            </tr>
          </tbody>
        </table>
      </DataTableContainer>
    )

    const scroll = screen.getByTestId('scroll')
    expect(scroll.parentElement?.className).not.toMatch(/ui-elevated-surface/)
  })
})
