import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DataTableContainer } from '../../../components/common/DataTableContainer'

function renderTable(props: { elevated?: boolean }) {
  render(
    <DataTableContainer data-testid="scroll" {...props}>
      <table>
        <tbody>
          <tr>
            <td>a</td>
          </tr>
        </tbody>
      </table>
    </DataTableContainer>
  )
  return screen.getByTestId('scroll')
}

describe('DataTableContainer', () => {
  it('wraps children in a bordered elevated surface when elevated (default)', () => {
    const scroll = renderTable({})

    expect(scroll.parentElement).toHaveAttribute('data-variant', 'bordered')
    expect(scroll).toHaveTextContent('a')
  })

  it('omits elevated shell when elevated={false}', () => {
    const scroll = renderTable({ elevated: false })

    expect(scroll.parentElement).not.toHaveAttribute('data-variant')
    expect(scroll).toHaveTextContent('a')
  })
})
