import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConnectionTabBar } from '../../components/layout/ConnectionTabBar'
import { useThemeStore } from '../../stores/theme-store'
import { setupMatchMedia } from '../helpers/mock-match-media'

beforeEach(() => {
  useThemeStore.setState({ theme: 'light', resolvedTheme: 'light' })
  document.documentElement.removeAttribute('data-theme')
  setupMatchMedia(false)
})

describe('ConnectionTabBar', () => {
  it('renders the New Connection button', () => {
    render(<ConnectionTabBar />)
    expect(screen.getByLabelText('New Connection')).toBeInTheDocument()
  })

  it('renders the theme toggle button', () => {
    render(<ConnectionTabBar />)
    expect(screen.getByTestId('theme-toggle')).toBeInTheDocument()
  })

  it('renders the settings gear button', () => {
    render(<ConnectionTabBar />)
    expect(screen.getByLabelText('Settings')).toBeInTheDocument()
  })

  it('clicking theme toggle switches from light to dark', async () => {
    const user = userEvent.setup()
    render(<ConnectionTabBar />)

    const toggleButton = screen.getByTestId('theme-toggle')
    await user.click(toggleButton)

    expect(useThemeStore.getState().resolvedTheme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('clicking theme toggle switches from dark to light', async () => {
    useThemeStore.setState({ theme: 'dark', resolvedTheme: 'dark' })

    const user = userEvent.setup()
    render(<ConnectionTabBar />)

    const toggleButton = screen.getByTestId('theme-toggle')
    await user.click(toggleButton)

    expect(useThemeStore.getState().resolvedTheme).toBe('light')
  })
})
