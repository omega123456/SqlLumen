import React from 'react'
import ReactDOM from 'react-dom/client'
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import { mockIPC } from '@tauri-apps/api/mocks'

import './lib/monaco-worker-setup'
import './styles/global.css'
import App from './App'
import { playwrightIpcMockHandler } from './lib/playwright-ipc-mock'
import { useSettingsStore } from './stores/settings-store'
import { useConnectionStore } from './stores/connection-store'
import { initAiMemoryStore } from './stores/ai-memory-store'

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
    mockIPC((cmd, args) => playwrightIpcMockHandler(cmd, args as Record<string, unknown>))

    // Expose stores for E2E tests to programmatically open tabs / toasts
    const { useWorkspaceStore } = await import('./stores/workspace-store')
    const { useToastStore } = await import('./stores/toast-store')
    const { useConnectionStore } = await import('./stores/connection-store')
    const { useQueryStore } = await import('./stores/query-store')
    const { useTableDataStore } = await import('./stores/table-data-store')
    const { useTableDesignerStore } = await import('./stores/table-designer-store')
    const { useObjectEditorStore } = await import('./stores/object-editor-store')
    const { useImportDialogStore } = await import('./stores/import-dialog-store')
    const { useAiStore } = await import('./stores/ai-store')
    const { useSchemaIndexStore } = await import('./stores/schema-index-store')
    const { useProcessListStore } = await import('./stores/processlist-store')
    const { useAiMemoryStore } = await import('./stores/ai-memory-store')
    const { useUpdateStore } = await import('./stores/update-store')
    ;(window as unknown as Record<string, unknown>).__workspaceStore__ = useWorkspaceStore
    ;(window as unknown as Record<string, unknown>).__toastStore__ = useToastStore
    ;(window as unknown as Record<string, unknown>).__connectionStore__ = useConnectionStore
    ;(window as unknown as Record<string, unknown>).__queryStore__ = useQueryStore
    ;(window as unknown as Record<string, unknown>).__tableDataStore__ = useTableDataStore
    ;(window as unknown as Record<string, unknown>).__tableDesignerStore__ = useTableDesignerStore
    ;(window as unknown as Record<string, unknown>).__objectEditorStore__ = useObjectEditorStore
    ;(window as unknown as Record<string, unknown>).__importDialogStore__ = useImportDialogStore
    ;(window as unknown as Record<string, unknown>).__aiStore__ = useAiStore
    ;(window as unknown as Record<string, unknown>).__schemaIndexStore__ = useSchemaIndexStore
    ;(window as unknown as Record<string, unknown>).__processListStore__ = useProcessListStore
    ;(window as unknown as Record<string, unknown>).__settingsStore__ = useSettingsStore
    ;(window as unknown as Record<string, unknown>).__aiMemoryStore__ = useAiMemoryStore
    ;(window as unknown as Record<string, unknown>).__updateStore__ = useUpdateStore
  }

  // Load all settings before rendering so stores/components can read them
  // synchronously. Theme is applied immediately to prevent flash.
  try {
    await useSettingsStore.getState().loadSettings()
    const theme = useSettingsStore.getState().getSetting('theme')
    const resolved =
      theme === 'dark' || theme === 'light'
        ? theme
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
    document.documentElement.setAttribute('data-theme', resolved)
  } catch {
    // Fallback: use system preference if settings load fails
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
  }

  // Register window close handler for session restore (fire-and-forget).
  // Must be called after settings are loaded so isEnabled() reads the right value.
  import('./stores/session-restore-store').then(({ registerCloseHandler }) => {
    void registerCloseHandler()
  })

  // Hydrate saved connections early so AI memory and other stores can use them
  void useConnectionStore.getState().fetchSavedConnections()

  // Bootstrap AI memory store (event listeners + model-change subscription)
  initAiMemoryStore()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void init()
