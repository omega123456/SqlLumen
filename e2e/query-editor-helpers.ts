import { expect, type Page } from '@playwright/test'
import { APP_READY_MS, connectToSample } from './helpers'

export function activePanel(page: Page) {
  return page.locator('[data-testid="workspace-panel"][data-active="true"]')
}

export async function openQueryEditorTab(page: Page) {
  // A new connection opens with one blank, active query tab
  await connectToSample(page)
  await expect(activePanel(page).getByTestId('query-editor-tab')).toBeAttached({
    timeout: APP_READY_MS,
  })
  await expect(activePanel(page).locator('.monaco-editor').first()).toBeVisible({
    timeout: APP_READY_MS,
  })
}

export async function focusMonacoEditor(page: Page, timeout = APP_READY_MS) {
  const editorSurface = activePanel(page).locator('.monaco-editor').first()
  await expect(editorSurface).toBeVisible({ timeout })
  await editorSurface.evaluate((editor) => {
    const textarea = editor.querySelector<HTMLTextAreaElement>('textarea.inputarea')
    textarea?.focus()
  })
  return editorSurface
}

export async function waitForQueryContent(page: Page, expectedContent: string) {
  await expect
    .poll(
      async () =>
        page.evaluate((expected) => {
          const queryStore = (
            window as unknown as {
              __queryStore__?: {
                getState?: () => {
                  tabs?: Record<string, { content?: string }>
                }
              }
            }
          ).__queryStore__

          return Object.values(queryStore?.getState?.().tabs ?? {}).some(
            (tab) => tab?.content === expected
          )
        }, expectedContent),
      { timeout: 5_000, intervals: [100, 200, 300] }
    )
    .toBe(true)
}

export async function typeQuery(page: Page, sql: string) {
  await focusMonacoEditor(page)
  await page.evaluate((content) => {
    const workspaceStore = (window as unknown as Record<string, unknown>).__workspaceStore__ as {
      getState: () => { activeTabByConnection: Record<string, string | null> }
    }
    const queryStore = (window as unknown as Record<string, unknown>).__queryStore__ as {
      getState: () => { setContent: (id: string, content: string) => void }
    }
    const activeTabId = workspaceStore.getState().activeTabByConnection['session-playwright-1']
    if (!activeTabId) {
      throw new Error('No active query tab')
    }
    queryStore.getState().setContent(activeTabId, content)
  }, sql)
  await waitForQueryContent(page, sql)
  await focusMonacoEditor(page)
}
