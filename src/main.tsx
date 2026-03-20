import React from 'react'
import ReactDOM from 'react-dom/client'

import './styles/global.css'
import App from './App'

async function init() {
  // Install Playwright mocks FIRST (before any invoke calls)
  if (import.meta.env.VITE_PLAYWRIGHT === 'true') {
    const { mockIPC } = await import('@tauri-apps/api/mocks')
    mockIPC((cmd) => {
      if (cmd === 'get_setting') return null
      if (cmd === 'set_setting') return null
      if (cmd === 'get_all_settings') return {}
      return null
    })
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
