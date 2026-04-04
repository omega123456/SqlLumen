import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dropdown } from '../../../components/common/Dropdown'

describe('Dropdown', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const options = [
    { value: '', label: 'None' },
    { value: 'a', label: 'Alpha', description: '--flag=a' },
    { value: 'b', label: 'Beta' },
  ]

  it('opens list and selects via click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <>
        <span id="lb">Pick</span>
        <Dropdown id="d" labelledBy="lb" options={options} value="" onChange={onChange} />
      </>
    )
    await user.click(screen.getByRole('combobox', { name: 'Pick' }))
    expect(screen.getByText('--flag=a')).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Alpha' }))
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('selects option with keyboard after open', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <>
        <span id="lb2">Pick</span>
        <Dropdown id="d2" labelledBy="lb2" options={options} value="" onChange={onChange} />
      </>
    )
    await user.click(screen.getByRole('combobox', { name: 'Pick' }))
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toHaveFocus()
    })
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    render(
      <>
        <span id="lb3">Pick</span>
        <Dropdown id="d3" labelledBy="lb3" options={options} value="" onChange={vi.fn()} />
      </>
    )
    await user.click(screen.getByRole('combobox', { name: 'Pick' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('does not open when disabled', async () => {
    const user = userEvent.setup()
    render(
      <>
        <span id="lb4">Pick</span>
        <Dropdown id="d4" labelledBy="lb4" options={options} value="" onChange={vi.fn()} disabled />
      </>
    )
    await user.click(screen.getByRole('combobox', { name: 'Pick' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes when trigger is clicked while open', async () => {
    const user = userEvent.setup()
    render(
      <>
        <span id="lb5">Pick</span>
        <Dropdown id="d5" labelledBy="lb5" options={options} value="" onChange={vi.fn()} />
      </>
    )
    const combobox = screen.getByRole('combobox', { name: 'Pick' })
    await user.click(combobox)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await user.click(combobox)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('selects last item via End and Enter on listbox', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <>
        <span id="lb6">Pick</span>
        <Dropdown id="d6" labelledBy="lb6" options={options} value="" onChange={onChange} />
      </>
    )
    await user.click(screen.getByRole('combobox', { name: 'Pick' }))
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toHaveFocus()
    })
    await user.keyboard('{End}')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('moves highlight with Home on listbox', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <>
        <span id="lb7">Pick</span>
        <Dropdown id="d7" labelledBy="lb7" options={options} value="b" onChange={onChange} />
      </>
    )
    await user.click(screen.getByRole('combobox', { name: 'Pick' }))
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toHaveFocus()
    })
    await user.keyboard('{Home}')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('Escape from listbox returns focus to combobox', async () => {
    const user = userEvent.setup()
    render(
      <>
        <span id="lb8">Pick</span>
        <Dropdown id="d8" labelledBy="lb8" options={options} value="" onChange={vi.fn()} />
      </>
    )
    const combobox = screen.getByRole('combobox', { name: 'Pick' })
    await user.click(combobox)
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toHaveFocus()
    })
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(combobox).toHaveFocus()
    })
  })

  it('fires Home/End on combobox while list is open', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <>
        <span id="lb9">Pick</span>
        <Dropdown id="d9" labelledBy="lb9" options={options} value="" onChange={onChange} />
      </>
    )
    const combobox = screen.getByRole('combobox', { name: 'Pick' })
    await user.click(combobox)
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })
    combobox.focus()
    fireEvent.keyDown(combobox, { key: 'End' })
    fireEvent.keyDown(combobox, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('skips disabled options when moving highlight', async () => {
    const user = userEvent.setup()
    const withDisabled = [
      { value: '', label: 'None' },
      { value: 'a', label: 'Alpha' },
      { value: 'x', label: 'Skip', disabled: true },
      { value: 'b', label: 'Beta' },
    ]
    const onChange = vi.fn()
    render(
      <>
        <span id="lb10">Pick</span>
        <Dropdown id="d10" labelledBy="lb10" options={withDisabled} value="" onChange={onChange} />
      </>
    )
    await user.click(screen.getByRole('combobox', { name: 'Pick' }))
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toHaveFocus()
    })
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{ArrowDown}')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('does not select disabled option via click', async () => {
    const user = userEvent.setup()
    const withDisabled = [
      { value: '', label: 'None' },
      { value: 'z', label: 'Blocked', disabled: true },
    ]
    const onChange = vi.fn()
    render(
      <>
        <span id="lb11">Pick</span>
        <Dropdown id="d11" labelledBy="lb11" options={withDisabled} value="" onChange={onChange} />
      </>
    )
    await user.click(screen.getByRole('combobox', { name: 'Pick' }))
    await user.click(screen.getByRole('option', { name: 'Blocked' }))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('updates highlight on mouse enter', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <>
        <span id="lb12">Pick</span>
        <Dropdown id="d12" labelledBy="lb12" options={options} value="" onChange={onChange} />
      </>
    )
    await user.click(screen.getByRole('combobox', { name: 'Pick' }))
    const beta = screen.getByRole('option', { name: 'Beta' })
    await user.hover(beta)
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('works with aria-label instead of labelledBy', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Dropdown id="aria-only" ariaLabel="Size" options={options} value="" onChange={onChange} />
    )
    await user.click(screen.getByRole('combobox', { name: 'Size' }))
    await user.click(screen.getByRole('option', { name: 'Alpha' }))
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('renders the listbox in document.body so it is not clipped by overflow ancestors', async () => {
    const user = userEvent.setup()

    render(
      <div style={{ overflow: 'hidden' }}>
        <span id="lb-portal">Pick</span>
        <Dropdown
          id="d-portal"
          labelledBy="lb-portal"
          options={options}
          value=""
          onChange={vi.fn()}
        />
      </div>
    )

    await user.click(screen.getByRole('combobox', { name: 'Pick' }))

    const listbox = screen.getByRole('listbox')
    expect(listbox.parentElement).toBe(document.body)
  })

  it('opens upward when there is not enough room below the trigger', async () => {
    const user = userEvent.setup()

    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(720)

    render(
      <>
        <span id="lb-top">Pick</span>
        <Dropdown id="d-top" labelledBy="lb-top" options={options} value="" onChange={vi.fn()} />
      </>
    )

    const trigger = screen.getByRole('combobox', { name: 'Pick' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
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

    await user.click(trigger)

    expect(screen.getByRole('listbox')).toHaveAttribute('data-placement', 'top')
  })

  it('supports multi-select without closing the listbox after each toggle', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <>
        <span id="lb-multi">Pick</span>
        <Dropdown
          id="d-multi"
          labelledBy="lb-multi"
          options={options.slice(1)}
          multiple
          value={['a']}
          onChange={onChange}
        />
      </>
    )

    await user.click(screen.getByRole('button', { name: 'Pick' }))
    await user.click(screen.getByRole('option', { name: 'Beta' }))

    expect(onChange).toHaveBeenCalledWith(['a', 'b'])
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('matches option sizing to the trigger element metrics', async () => {
    const user = userEvent.setup()

    render(
      <>
        <span id="lb-size">Pick</span>
        <Dropdown
          id="d-size"
          labelledBy="lb-size"
          options={options}
          value=""
          onChange={vi.fn()}
          triggerProps={{
            style: {
              fontSize: '11px',
              lineHeight: '16px',
              padding: '2px 4px',
              height: '24px',
            },
          }}
        />
      </>
    )

    await user.click(screen.getByRole('combobox', { name: 'Pick' }))

    const listbox = screen.getByRole('listbox')
    await waitFor(() => {
      expect(listbox.style.getPropertyValue('--ui-dropdown-instance-option-font-size')).toBe('11px')
    })
    expect(listbox.style.getPropertyValue('--ui-dropdown-instance-option-font-size')).toBe('11px')
    expect(listbox.style.getPropertyValue('--ui-dropdown-instance-option-line-height')).toBe('16px')
    expect(listbox.style.getPropertyValue('--ui-dropdown-instance-option-padding-block')).toBe(
      '2px'
    )
    expect(listbox.style.getPropertyValue('--ui-dropdown-instance-option-padding-inline')).toBe(
      '4px'
    )
    expect(listbox.style.getPropertyValue('--ui-dropdown-instance-option-min-height')).toBe('24px')
  })

  it('supports typeahead letter navigation while the listbox is open', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <>
        <span id="lb-typeahead">Pick</span>
        <Dropdown
          id="d-typeahead"
          labelledBy="lb-typeahead"
          options={options}
          value=""
          onChange={onChange}
        />
      </>
    )

    await user.click(screen.getByRole('combobox', { name: 'Pick' }))
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toHaveFocus()
    })

    await user.keyboard('b')
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('b')
  })

  it('selects an option on click even when mousedown is prevented', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <>
        <span id="lb-click">Pick</span>
        <Dropdown
          id="d-click"
          labelledBy="lb-click"
          options={options}
          value=""
          onChange={onChange}
        />
      </>
    )

    await user.click(screen.getByRole('combobox', { name: 'Pick' }))
    await user.click(screen.getByRole('option', { name: 'Beta' }))

    expect(onChange).toHaveBeenCalledWith('b')
  })
})
