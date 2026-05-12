import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ShortcutBinding } from '../../../types/schema'

const originalUserAgent = window.navigator.userAgent

async function renderBadgeForUserAgent(userAgent: string, binding: ShortcutBinding) {
  vi.resetModules()
  Object.defineProperty(window.navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  })

  const { KeyCapBadge } = await import('../../../components/settings/KeyCapBadge')
  render(<KeyCapBadge binding={binding} />)
}

describe('KeyCapBadge', () => {
  afterEach(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    })
    vi.resetModules()
  })

  it('renders non-mac labels and fallbacks', async () => {
    await renderBadgeForUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', {
      modifiers: ['ctrl', 'shift', 'alt', 'meta'],
      key: 'Enter',
    })

    expect(screen.getByText('Ctrl')).toBeInTheDocument()
    expect(screen.getByText('Shift')).toBeInTheDocument()
    expect(screen.getByText('Alt')).toBeInTheDocument()
    expect(screen.getByText('meta')).toBeInTheDocument()
    expect(screen.getByText('Enter')).toBeInTheDocument()
  })

  it('renders mac-specific symbols and friendly key labels', async () => {
    await renderBadgeForUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', {
      modifiers: ['ctrl', 'shift', 'alt'],
      key: ' ',
    })

    expect(screen.getByText('⌘')).toBeInTheDocument()
    expect(screen.getByText('⇧')).toBeInTheDocument()
    expect(screen.getByText('⌥')).toBeInTheDocument()
    expect(screen.getByText('Space')).toBeInTheDocument()
  })

  it('uppercases single-character keys', async () => {
    await renderBadgeForUserAgent('Mozilla/5.0 (X11; Linux x86_64)', {
      modifiers: [],
      key: 'k',
    })

    expect(screen.getByText('K')).toBeInTheDocument()
  })
})
