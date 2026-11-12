import React from 'react'
import ReactDOM from 'react-dom/client'
import { mockIPC } from '@tauri-apps/api/mocks'

import './lib/monaco-worker-setup'
import './styles/global.css'
import App from './App'
import { playwrightIpcMockHandler } from './lib/playwright-ipc-mock'
import { useSettingsStore } from './stores/settings-store'
import { useConnectionStore } from './stores/connection-store'
import { initAiMemoryStore } from './stores/ai-memory-store'
import { hasTauriApis, isPlaywrightBuild } from './lib/tauri-env'
import { logBootstrapFailure, logFrontend } from './lib/app-log-commands'
import type * as Monaco from 'monaco-editor'

// Canvas grids (glide) only repaint when `document.fonts.ready` settles, and webfonts are
// fetched lazily on first DOM use. Request the grid's mono faces up front so the first
// canvas paint isn't stuck on a fallback font until the grid remounts.
for (const font of ['13px', '700 10px', 'italic 13px']) {
  void document.fonts?.load(`${font} "JetBrains Mono"`)
}

document.documentElement.dataset.windowFocused = String(document.hasFocus())
window.addEventListener('focus', () => (document.documentElement.dataset.windowFocused = 'true'))
window.addEventListener('blur', () => (document.documentElement.dataset.windowFocused = 'false'))

const MONACO_WORKER_ENTRY = 'workerMain.js'

type MonacoModule = typeof Monaco

type LabelledWebWorkerOptions = Monaco.editor.IInternalWebWorkerOptions & { label?: string }

function createLabelledWorker(label: string): Worker | Promise<Worker> | undefined {
  const environment = self.MonacoEnvironment
  if (!environment?.getWorker) return undefined
  try {
    return environment.getWorker(MONACO_WORKER_ENTRY, label)
  } catch (error) {
    logFrontend('warn', `[main] Creating the Monaco "${label}" worker failed: ${String(error)}`)
    return undefined
  }
}

function resolveMissingWorker(
  options: LabelledWebWorkerOptions
): Worker | Promise<Worker> | undefined {
  if (options.worker) return undefined
  if (!options.label) return undefined
  return createLabelledWorker(options.label)
}

// monaco-sql-languages omits `worker` from createWebWorker options, which Monaco >= 0.55 requires.
function supplyWorkerToSqlLanguageWorkers(monaco: MonacoModule): void {
  const originalCreateWebWorker = monaco.editor.createWebWorker.bind(monaco.editor)

  function createWebWorkerWithLabelledWorker(options: LabelledWebWorkerOptions) {
    const missingWorker = resolveMissingWorker(options)
    if (missingWorker) {
      options.worker = missingWorker
    }
    return originalCreateWebWorker(options)
  }

  Object.assign(monaco.editor, { createWebWorker: createWebWorkerWithLabelledWorker })
}

async function configureMonaco(monaco: MonacoModule): Promise<void> {
  const { loader } = await import('@monaco-editor/react')
  loader.config({ monaco })
  supplyWorkerToSqlLanguageWorkers(monaco)
}

import('monaco-editor').then(configureMonaco).catch(logBootstrapFailure)

async function init() {
  // Install Playwright mocks FIRST (before any invoke calls)
  if (isPlaywrightBuild()) {
    mockIPC((command, args) => playwrightIpcMockHandler(command, args as Record<string, unknown>))

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
    const { buildExecuteQueryPlanFromSql, runExecuteQueryPlan } =
      await import('./lib/query-execution-plan')
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
    ;(window as unknown as Record<string, unknown>).__executeActiveQueryPlan__ = (
      connectionId: string,
      tabId: string
    ) => {
      const queryState = useQueryStore.getState()
      const tab = queryState.tabs[tabId]
      if (!tab?.content?.trim()) {
        return
      }
      const plan = buildExecuteQueryPlanFromSql(tab.content)
      if (!plan) {
        return
      }
      runExecuteQueryPlan(queryState, connectionId, tabId, plan)
    }
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

    // Apply saved zoom level before first render to prevent flash
    const zoom = useSettingsStore.getState().getSetting('appearance.zoom')
    if (zoom && zoom !== '100') {
      document.documentElement.style.zoom = `${zoom}%`
    }
  } catch (error) {
    logFrontend('warn', `[main] Applying saved appearance settings failed: ${String(error)}`)
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
  }

  // Register window close handler for session restore (fire-and-forget).
  // Must be called after settings are loaded so isEnabled() reads the right value.
  import('./stores/session-restore-store').then(({ registerCloseHandler }) => {
    void registerCloseHandler()
  })

  // Register the snapshot scheduler (periodic check + on-close hook). Tauri-only;
  // the scheduler self-guards when no Tauri APIs / window are available.
  if (hasTauriApis()) {
    import('./stores/snapshot-store').then(({ registerSnapshotScheduler }) => {
      registerSnapshotScheduler()
    })
  }

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
