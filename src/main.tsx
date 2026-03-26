import React from 'react'
import ReactDOM from 'react-dom/client'
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'

import './lib/monaco-worker-setup'
import './styles/global.css'
import App from './App'

// Use locally-installed monaco-editor instead of CDN.
// This ensures our MonacoEnvironment.getWorker setup is used and the
// mysql worker (with dt-sql-parser) is bundled by Vite.
loader.config({ monaco })

// ---------------------------------------------------------------------------
// Patch editor.createWebWorker
// ---------------------------------------------------------------------------
// monaco-sql-languages' WorkerManager calls
//   editor.createWebWorker({ moduleId, label, createData })
// but Monaco ≥ 0.55 expects `opts.worker` (a Worker instance)
// to be set. When it is missing the internal WebWorker constructor
// fails and Monaco falls back to a synchronous EditorWorker with
// no foreign module.
//
// We intercept `createWebWorker` and inject a `worker` property
// created from our MonacoEnvironment.getWorker so the real web
// worker (with dt-sql-parser) is used.
// ---------------------------------------------------------------------------
const origCreateWebWorker = monaco.editor.createWebWorker.bind(monaco.editor)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
monaco.editor.createWebWorker = function patchedCreateWebWorker<T extends object>(
  opts: Parameters<typeof origCreateWebWorker>[0]
): monaco.editor.MonacoWebWorker<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o = opts as any
  if (!o.worker && o.label) {
    const env = self.MonacoEnvironment
    if (env?.getWorker) {
      try {
        o.worker = env.getWorker('workerMain.js', o.label)
      } catch {
        // fall through — let Monaco handle it
      }
    }
  }
  return origCreateWebWorker(opts)
}

async function init() {
  // Install Playwright mocks FIRST (before any invoke calls)
  if (import.meta.env.VITE_PLAYWRIGHT === 'true') {
    const { mockIPC } = await import('@tauri-apps/api/mocks')
    const { playwrightIpcMockHandler } = await import('./lib/playwright-ipc-mock')
    mockIPC((cmd, args) => playwrightIpcMockHandler(cmd, args as Record<string, unknown>))

    // Expose stores for E2E tests to programmatically open tabs / toasts
    const { useWorkspaceStore } = await import('./stores/workspace-store')
    const { useToastStore } = await import('./stores/toast-store')
    const { useConnectionStore } = await import('./stores/connection-store')
    const { useQueryStore } = await import('./stores/query-store')
    const { useTableDataStore } = await import('./stores/table-data-store')
    ;(window as unknown as Record<string, unknown>).__workspaceStore__ = useWorkspaceStore
    ;(window as unknown as Record<string, unknown>).__toastStore__ = useToastStore
    ;(window as unknown as Record<string, unknown>).__connectionStore__ = useConnectionStore
    ;(window as unknown as Record<string, unknown>).__queryStore__ = useQueryStore
    ;(window as unknown as Record<string, unknown>).__tableDataStore__ = useTableDataStore
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
