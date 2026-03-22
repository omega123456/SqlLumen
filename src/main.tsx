import React from 'react'
import ReactDOM from 'react-dom/client'

import './styles/global.css'
import App from './App'

async function init() {
  // Install Playwright mocks FIRST (before any invoke calls)
  if (import.meta.env.VITE_PLAYWRIGHT === 'true') {
    const { mockIPC } = await import('@tauri-apps/api/mocks')
    const { playwrightIpcMockHandler } = await import('./lib/playwright-ipc-mock')
    mockIPC((cmd, args) => playwrightIpcMockHandler(cmd, args as Record<string, unknown>))

    // Expose stores for E2E tests to programmatically open tabs / toasts
    const { useWorkspaceStore } = await import('./stores/workspace-store')
    const { useToastStore } = await import('./stores/toast-store')
    ;(window as unknown as Record<string, unknown>).__workspaceStore__ = useWorkspaceStore
    ;(window as unknown as Record<string, unknown>).__toastStore__ = useToastStore
  }

  // Apply theme before React renders to prevent flash
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const savedTheme = await invoke<string | null>('get_setting', { key: 'theme' })
    const resolved =
      savedTheme === 'dark' || savedTheme === 'light'
        ? savedTheme
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
    document.documentElement.setAttribute('data-theme', resolved)
  } catch {
    // Fallback: use system preference if IPC fails
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void init()
