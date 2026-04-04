import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TypeCombobox } from '../../../components/table-designer/TypeCombobox'

describe('TypeCombobox', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders with initial value', () => {
    render(<TypeCombobox value="VARCHAR" onChange={vi.fn()} />)
    expect(screen.getByRole('combobox')).toHaveTextContent('VARCHAR')
  })

  it('opens dropdown on click', async () => {
    const user = userEvent.setup()
    render(<TypeCombobox value="VARCHAR" onChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))

    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('renders MySQL types with their groups', async () => {
    const user = userEvent.setup()
    render(<TypeCombobox value="VARCHAR" onChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Numeric')
    expect(screen.getByRole('option', { name: 'VARCHAR' })).toHaveTextContent('String')
    expect(screen.getByRole('option', { name: 'DATE' })).toHaveTextContent('Date & Time')
  })

  it('renders types in Numeric group', async () => {
    const user = userEvent.setup()
    render(<TypeCombobox value="VARCHAR" onChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))

    expect(screen.getByRole('option', { name: 'INT' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'BIGINT' })).toBeInTheDocument()
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

    const trigger = screen.getByRole('combobox')
    await user.click(trigger)
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('ArrowDown/ArrowUp navigates options', async () => {
    const user = userEvent.setup()
    render(<TypeCombobox value="INT" onChange={vi.fn()} />)

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.keyboard('{ArrowDown}')

    let activeOption = document.getElementById(
      screen.getByRole('listbox').getAttribute('aria-activedescendant') ?? ''
    )
    expect(activeOption).toHaveTextContent('TINYINT')

    await user.keyboard('{ArrowUp}')

    activeOption = document.getElementById(
      screen.getByRole('listbox').getAttribute('aria-activedescendant') ?? ''
    )
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

  it('opens upward when there is not enough room below the input', async () => {
    const user = userEvent.setup()

    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(720)

    render(<TypeCombobox value="VARCHAR" onChange={vi.fn()} />)

    const input = screen.getByRole('combobox')

    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 660,
      width: 240,
      height: 40,
      top: 660,
      right: 240,
      bottom: 700,
      left: 0,
      toJSON: () => ({}),
    })

    await user.click(input)

    expect(screen.getByRole('listbox')).toHaveAttribute('data-placement', 'top')
  })

  it('renders the listbox in document.body so it is not clipped by overflow ancestors', async () => {
    const user = userEvent.setup()
    render(<TypeCombobox value="VARCHAR" onChange={vi.fn()} />)

    await user.click(screen.getByRole('combobox'))

    const listbox = screen.getByRole('listbox')
    expect(listbox.parentElement).toBe(document.body)
  })
})
