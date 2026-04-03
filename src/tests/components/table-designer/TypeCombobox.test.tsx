import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TypeCombobox } from '../../../components/table-designer/TypeCombobox'
import { TYPES_WITHOUT_LENGTH } from '../../../components/table-designer/table-designer-type-constants'

void TYPES_WITHOUT_LENGTH

describe('TypeCombobox', () => {
  it('renders with initial value', () => {
    render(<TypeCombobox value="VARCHAR" onChange={vi.fn()} />)
    expect(screen.getByRole('combobox')).toHaveValue('VARCHAR')
  })

  it('opens dropdown on click', async () => {
    const user = userEvent.setup()
    render(<TypeCombobox value="VARCHAR" onChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))

    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('renders all 5 category groups', async () => {
    const user = userEvent.setup()
    render(<TypeCombobox value="VARCHAR" onChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))

    expect(screen.getByText('Numeric')).toBeInTheDocument()
    expect(screen.getByText('String')).toBeInTheDocument()
    expect(screen.getByText('Date & Time')).toBeInTheDocument()
    expect(screen.getByText('Spatial')).toBeInTheDocument()
    expect(screen.getByText('JSON', { selector: 'div' })).toBeInTheDocument()
  })

  it('renders types in Numeric group', async () => {
    const user = userEvent.setup()
    render(<TypeCombobox value="VARCHAR" onChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))

    expect(screen.getByRole('option', { name: 'INT' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'BIGINT' })).toBeInTheDocument()
  })

  it('filter: typing "var" shows only VARCHAR and VARBINARY', async () => {
    const user = userEvent.setup()
    render(<TypeCombobox value="INT" onChange={vi.fn()} />)

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.type(input, 'var')

    expect(screen.getByRole('option', { name: 'VARCHAR' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'VARBINARY' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'INT' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'JSON' })).not.toBeInTheDocument()
  })

  it('filter: empty filter shows all groups', async () => {
    const user = userEvent.setup()
    render(<TypeCombobox value="INT" onChange={vi.fn()} />)

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.type(input, 'var')
    await user.clear(input)

    expect(screen.getByText('Numeric')).toBeInTheDocument()
    expect(screen.getByText('String')).toBeInTheDocument()
    expect(screen.getByText('Date & Time')).toBeInTheDocument()
    expect(screen.getByText('Spatial')).toBeInTheDocument()
    expect(screen.getByText('JSON', { selector: 'div' })).toBeInTheDocument()
  })

  it('filter: hides group header when all group types filtered out', async () => {
    const user = userEvent.setup()
    render(<TypeCombobox value="INT" onChange={vi.fn()} />)

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.type(input, 'json')

    expect(screen.getByText('JSON', { selector: 'div' })).toBeInTheDocument()
    expect(screen.queryByText('Numeric')).not.toBeInTheDocument()
    expect(screen.queryByText('String')).not.toBeInTheDocument()
  })

  it('clicking an option calls onChange and closes dropdown', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TypeCombobox value="INT" onChange={onChange} />)

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: 'BIGINT' }))

    expect(onChange).toHaveBeenCalledWith('BIGINT')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('Escape key closes dropdown', async () => {
    const user = userEvent.setup()
    render(<TypeCombobox value="INT" onChange={vi.fn()} />)

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('ArrowDown/ArrowUp navigates options', async () => {
    const user = userEvent.setup()
    render(<TypeCombobox value="INT" onChange={vi.fn()} />)

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.keyboard('{ArrowDown}')

    let activeOption = document.getElementById(input.getAttribute('aria-activedescendant') ?? '')
    expect(activeOption).toHaveTextContent('TINYINT')

    await user.keyboard('{ArrowUp}')

    activeOption = document.getElementById(input.getAttribute('aria-activedescendant') ?? '')
    expect(activeOption).toHaveTextContent('INT')
  })

  it('Enter key selects focused option', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TypeCombobox value="INT" onChange={onChange} />)

    await user.click(screen.getByRole('combobox'))
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('TINYINT')
  })

  it('clicking outside closes dropdown', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <TypeCombobox value="INT" onChange={vi.fn()} />
        <button type="button">Outside</button>
      </div>
    )

    await user.click(screen.getByRole('combobox'))
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }))

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
