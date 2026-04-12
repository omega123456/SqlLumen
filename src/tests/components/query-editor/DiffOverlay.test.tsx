import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { mockIPC } from '@tauri-apps/api/mocks'
import { DiffOverlay, applyHunkToOriginal } from '../../../components/query-editor/DiffOverlay'
import type { LineChange } from '../../../components/query-editor/DiffOverlay'
import type * as monaco from 'monaco-editor'

function setupMockIPC() {
  mockIPC((cmd) => {
    if (cmd === 'log_frontend') return undefined
    if (cmd === 'plugin:event|listen') return () => {}
    if (cmd === 'plugin:event|unlisten') return undefined
    if (cmd === 'get_setting') return null
    if (cmd === 'set_setting') return undefined
    if (cmd === 'get_all_settings') return {}
    throw new Error(`[vitest] Unmocked Tauri IPC command: ${cmd}`)
  })
}

const DEFAULT_RANGE = {
  startLineNumber: 1,
  endLineNumber: 1,
  startColumn: 1,
  endColumn: 20,
}

const DEFAULT_PROPS = {
  originalSql: 'SELECT * FROM users',
  proposedSql: 'SELECT id, name FROM users WHERE active = 1',
  originalRange: DEFAULT_RANGE,
  onAccept: vi.fn(),
  onReject: vi.fn(),
}

beforeEach(() => {
  setupMockIPC()
  DEFAULT_PROPS.onAccept = vi.fn()
  DEFAULT_PROPS.onReject = vi.fn()
})

describe('DiffOverlay', () => {
  it('renders with data-testid="diff-overlay"', () => {
    render(<DiffOverlay {...DEFAULT_PROPS} />)
    expect(screen.getByTestId('diff-overlay')).toBeInTheDocument()
  })

  it('shows "Review Changes" header text', () => {
    render(<DiffOverlay {...DEFAULT_PROPS} />)
    expect(screen.getByText('Review Changes')).toBeInTheDocument()
  })

  it('renders the mock diff editor', () => {
    render(<DiffOverlay {...DEFAULT_PROPS} />)
    const diffEditor = screen.getByTestId('mock-diff-editor')
    expect(diffEditor).toBeInTheDocument()
  })

  it('calls onMount to set up manual models', async () => {
    const { unmount } = render(<DiffOverlay {...DEFAULT_PROPS} />)
    // Wait for the mock onMount to fire (setTimeout(0) in mock)
    await waitFor(() => {
      expect(screen.getByTestId('mock-diff-editor')).toBeInTheDocument()
    })
    // Unmount should not throw — models are cleaned up safely
    unmount()
  })

  it('calls onAccept with proposedSql when Accept All is clicked (no hunks accepted)', async () => {
    const user = userEvent.setup()
    render(<DiffOverlay {...DEFAULT_PROPS} />)

    await user.click(screen.getByTestId('diff-accept-all-button'))
    expect(DEFAULT_PROPS.onAccept).toHaveBeenCalledTimes(1)
    expect(DEFAULT_PROPS.onAccept).toHaveBeenCalledWith(DEFAULT_PROPS.proposedSql)
  })

  it('calls onReject when Reject All button is clicked', async () => {
    const user = userEvent.setup()
    render(<DiffOverlay {...DEFAULT_PROPS} />)

    await user.click(screen.getByTestId('diff-reject-button'))
    expect(DEFAULT_PROPS.onReject).toHaveBeenCalledTimes(1)
  })

  it('renders Accept All button with primary variant', () => {
    render(<DiffOverlay {...DEFAULT_PROPS} />)
    const acceptBtn = screen.getByTestId('diff-accept-all-button')
    expect(acceptBtn).toHaveTextContent('Accept All')
  })

  it('renders Reject All button with danger variant', () => {
    render(<DiffOverlay {...DEFAULT_PROPS} />)
    const rejectBtn = screen.getByTestId('diff-reject-button')
    expect(rejectBtn).toHaveTextContent('Reject All')
    expect(rejectBtn).toHaveClass('ui-button-danger')
  })

  it('renders Accept All, Reject All, and Close buttons', () => {
    render(<DiffOverlay {...DEFAULT_PROPS} />)
    expect(screen.getByTestId('diff-accept-all-button')).toBeInTheDocument()
    expect(screen.getByTestId('diff-reject-button')).toBeInTheDocument()
    expect(screen.getByTestId('diff-close-button')).toBeInTheDocument()
  })

  it('calls onReject when Close is clicked and no hunks were accepted', async () => {
    const user = userEvent.setup()
    render(<DiffOverlay {...DEFAULT_PROPS} />)

    await user.click(screen.getByTestId('diff-close-button'))
    expect(DEFAULT_PROPS.onReject).toHaveBeenCalledTimes(1)
    expect(DEFAULT_PROPS.onAccept).not.toHaveBeenCalled()
  })

  it('unmounts cleanly without TextModel disposal crash', async () => {
    const { unmount } = render(<DiffOverlay {...DEFAULT_PROPS} />)
    // Allow onMount to fire
    await waitFor(() => {
      expect(screen.getByTestId('mock-diff-editor')).toBeInTheDocument()
    })
    // Should not throw "TextModel got disposed before DiffEditorWidget model got reset"
    expect(() => unmount()).not.toThrow()
  })

  it('updates model content when proposedSql prop changes (rerender)', async () => {
    const monacoMod = await import('monaco-editor')
    const createModelMock = vi.mocked(monacoMod.editor.createModel)

    // Track setValue calls on every model created via createModel.
    // The mock DiffEditor re-fires onMount on each render, so handleMount
    // may be called more than once, each time creating a fresh pair of
    // models.  We track the *latest* pair so we can assert the useEffect
    // called setValue on the models that are current at rerender time.
    const originalSetValue = vi.fn()
    const modifiedSetValue = vi.fn()
    let callIndex = 0

    createModelMock.mockImplementation(
      () =>
        ({
          dispose: vi.fn(),
          getValue: vi.fn(() => ''),
          setValue: callIndex++ % 2 === 0 ? originalSetValue : modifiedSetValue,
        }) as unknown as ReturnType<typeof monacoMod.editor.createModel>
    )

    const { rerender } = render(
      <DiffOverlay {...DEFAULT_PROPS} originalSql="SELECT 1" proposedSql="SELECT 2" />
    )

    // Wait for onMount to fire (setTimeout(0) in mock)
    await waitFor(() => {
      expect(screen.getByTestId('mock-diff-editor')).toBeInTheDocument()
    })
    // Allow the mount callback to execute
    await new Promise((r) => setTimeout(r, 10))

    // Clear any setValue calls from mount-time effects
    originalSetValue.mockClear()
    modifiedSetValue.mockClear()

    // Rerender with new proposedSql
    rerender(<DiffOverlay {...DEFAULT_PROPS} originalSql="SELECT 1" proposedSql="SELECT 3" />)

    // The useEffect should call setValue on both models after the rerender.
    // The mock DiffEditor also re-fires onMount (setTimeout(0)), so we
    // need to wait for all async effects to settle.
    await waitFor(() => {
      expect(modifiedSetValue).toHaveBeenCalledWith('SELECT 3')
      expect(originalSetValue).toHaveBeenCalledWith('SELECT 1')
    })

    // Restore the default createModel mock for other tests
    createModelMock.mockRestore()
  })

  it('does not render per-hunk Accept controls when no line changes exist', () => {
    render(<DiffOverlay {...DEFAULT_PROPS} />)
    expect(screen.queryByTestId('hunk-accept-inline-0')).not.toBeInTheDocument()
  })

  it.each(['diff-close-button', 'diff-accept-all-button'])(
    'after per-hunk accept, %s applies merged orig model to onAccept',
    async (finishButtonTestId) => {
      const monacoMod = await import('monaco-editor')
      const createModelMock = vi.mocked(monacoMod.editor.createModel)
      const mockGetValue = vi.fn(() => 'MERGED SQL')
      const mockPushEditOperations = vi.fn()

      createModelMock.mockImplementation(
        () =>
          ({
            dispose: vi.fn(),
            getValue: mockGetValue,
            setValue: vi.fn(),
            getLineCount: vi.fn(() => 1),
            getLineMaxColumn: vi.fn(() => 20),
            getValueInRange: vi.fn(() => 'some text'),
            pushEditOperations: mockPushEditOperations,
          }) as unknown as ReturnType<typeof monacoMod.editor.createModel>
      )

      // Patch the DiffEditor mock to return line changes via getLineChanges.
      // The global mock (setup.ts) returns null from getLineChanges, so we
      // intercept the onMount callback to patch it before DiffOverlay sees it.
      const reactEditorMod = await import('@monaco-editor/react')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = reactEditorMod as any
      const OrigDiffEditor = mod.DiffEditor
      const React = await import('react')

      const lineChanges = [
        {
          originalStartLineNumber: 1,
          originalEndLineNumber: 1,
          modifiedStartLineNumber: 1,
          modifiedEndLineNumber: 1,
        },
      ]

      mod.DiffEditor = function PatchedDiffEditor(props: Record<string, unknown>) {
        const origOnMount = props.onMount as ((editor: unknown) => void) | undefined
        const patchedOnMount = React.useCallback(
          (editor: Record<string, unknown>) => {
            editor.getLineChanges = vi.fn(() => lineChanges)
            origOnMount?.(editor)
          },
          [origOnMount]
        )
        return React.createElement(OrigDiffEditor, { ...props, onMount: patchedOnMount })
      }

      const user = userEvent.setup()
      render(<DiffOverlay {...DEFAULT_PROPS} />)

      await waitFor(() => {
        expect(screen.getByTestId('hunk-accept-inline-0')).toBeInTheDocument()
      })

      const hunkBtn = screen.getByTestId('hunk-accept-inline-0')
      expect(hunkBtn).toBeInTheDocument()
      await user.click(hunkBtn)

      expect(mockPushEditOperations).toHaveBeenCalled()

      await user.click(screen.getByTestId(finishButtonTestId))
      expect(DEFAULT_PROPS.onAccept).toHaveBeenCalledTimes(1)
      expect(DEFAULT_PROPS.onAccept).toHaveBeenCalledWith('MERGED SQL')
      expect(DEFAULT_PROPS.onReject).not.toHaveBeenCalled()

      mod.DiffEditor = OrigDiffEditor
      createModelMock.mockRestore()
    }
  )

  it('renders per-hunk Accept for a modified line within model line count', async () => {
    const monacoMod = await import('monaco-editor')
    const createModelMock = vi.mocked(monacoMod.editor.createModel)

    createModelMock.mockImplementation(
      () =>
        ({
          dispose: vi.fn(),
          getValue: vi.fn(() => ''),
          setValue: vi.fn(),
          getLineCount: vi.fn(() => 5),
          getLineMaxColumn: vi.fn((line: number) => (line === 3 ? 10 : 20)),
          getValueInRange: vi.fn(() => ''),
          pushEditOperations: vi.fn(),
        }) as unknown as ReturnType<typeof monacoMod.editor.createModel>
    )

    const lineChanges = [
      {
        originalStartLineNumber: 1,
        originalEndLineNumber: 1,
        modifiedStartLineNumber: 3,
        modifiedEndLineNumber: 3,
      },
    ]

    const reactEditorMod = await import('@monaco-editor/react')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = reactEditorMod as any
    const OrigDiffEditor = mod.DiffEditor
    const React = await import('react')

    mod.DiffEditor = function PatchedDiffEditor(props: Record<string, unknown>) {
      const origOnMount = props.onMount as ((editor: unknown) => void) | undefined
      const patchedOnMount = React.useCallback(
        (editor: Record<string, unknown>) => {
          editor.getLineChanges = vi.fn(() => lineChanges)
          origOnMount?.(editor)
        },
        [origOnMount]
      )
      return React.createElement(OrigDiffEditor, { ...props, onMount: patchedOnMount })
    }

    render(<DiffOverlay {...DEFAULT_PROPS} />)

    await waitFor(() => {
      expect(screen.getByTestId('hunk-accept-inline-0')).toBeInTheDocument()
    })
    expect(screen.getByTestId('hunk-accept-inline-0')).toHaveTextContent('Accept')

    mod.DiffEditor = OrigDiffEditor
    createModelMock.mockRestore()
  })
})

describe('applyHunkToOriginal', () => {
  function makeMockModel(
    content: string
  ): monaco.editor.ITextModel & { _pushEditCalls: Array<{ range: unknown; text: string }> } {
    const lines = content.split('\n')
    const pushEditCalls: Array<{ range: unknown; text: string }> = []

    return {
      _pushEditCalls: pushEditCalls,
      getLineCount: vi.fn(() => lines.length),
      getLineMaxColumn: vi.fn((line: number) => (lines[line - 1]?.length ?? 0) + 1),
      getValueInRange: vi.fn((range: { startLineNumber: number; endLineNumber: number }) => {
        const start = range.startLineNumber - 1
        const end = range.endLineNumber
        return lines.slice(start, end).join('\n')
      }),
      pushEditOperations: vi.fn(
        (...args: [null, Array<{ range: unknown; text: string }>, () => null]) => {
          const edits = args[1]
          for (const edit of edits) {
            pushEditCalls.push({ range: edit.range, text: edit.text })
          }
          return null
        }
      ),
    } as unknown as monaco.editor.ITextModel & {
      _pushEditCalls: Array<{ range: unknown; text: string }>
    }
  }

  it('applies a replacement hunk (modified lines replace original lines)', () => {
    const origModel = makeMockModel('SELECT * FROM users')
    const modModel = makeMockModel('SELECT id, name FROM users WHERE active = 1')

    const change: LineChange = {
      originalStartLineNumber: 1,
      originalEndLineNumber: 1,
      modifiedStartLineNumber: 1,
      modifiedEndLineNumber: 1,
    }

    applyHunkToOriginal(change, origModel, modModel)

    expect(origModel.pushEditOperations).toHaveBeenCalledTimes(1)
    expect(origModel._pushEditCalls).toHaveLength(1)
    expect(origModel._pushEditCalls[0].text).toBe('SELECT id, name FROM users WHERE active = 1')
  })

  it('applies a pure insertion hunk (originalEndLineNumber === 0)', () => {
    const origModel = makeMockModel('line 1')
    const modModel = makeMockModel('line 1\ninserted line')

    const change: LineChange = {
      originalStartLineNumber: 1,
      originalEndLineNumber: 0,
      modifiedStartLineNumber: 2,
      modifiedEndLineNumber: 2,
    }

    applyHunkToOriginal(change, origModel, modModel)

    expect(origModel.pushEditOperations).toHaveBeenCalledTimes(1)
    expect(origModel._pushEditCalls).toHaveLength(1)
    // For insertion after last line, should prepend \n
    expect(origModel._pushEditCalls[0].text).toContain('inserted line')
  })

  it('applies a pure deletion hunk (modifiedEndLineNumber === 0)', () => {
    const origModel = makeMockModel('line 1\nline 2\nline 3')
    const modModel = makeMockModel('line 1\nline 3')

    const change: LineChange = {
      originalStartLineNumber: 2,
      originalEndLineNumber: 2,
      modifiedStartLineNumber: 1,
      modifiedEndLineNumber: 0,
    }

    applyHunkToOriginal(change, origModel, modModel)

    expect(origModel.pushEditOperations).toHaveBeenCalledTimes(1)
    expect(origModel._pushEditCalls).toHaveLength(1)
    expect(origModel._pushEditCalls[0].text).toBe('')
  })

  it('handles multi-line replacement', () => {
    const origModel = makeMockModel('line 1\nline 2\nline 3')
    const modModel = makeMockModel('new line A\nnew line B')

    const change: LineChange = {
      originalStartLineNumber: 1,
      originalEndLineNumber: 2,
      modifiedStartLineNumber: 1,
      modifiedEndLineNumber: 2,
    }

    applyHunkToOriginal(change, origModel, modModel)

    expect(origModel.pushEditOperations).toHaveBeenCalledTimes(1)
    expect(origModel._pushEditCalls[0].text).toBe('new line A\nnew line B')
  })

  it('handles insertion at end of file (originalStartLineNumber >= lineCount)', () => {
    const origModel = makeMockModel('only line')
    const modModel = makeMockModel('only line\nappended line')

    const change: LineChange = {
      originalStartLineNumber: 1,
      originalEndLineNumber: 0,
      modifiedStartLineNumber: 2,
      modifiedEndLineNumber: 2,
    }

    applyHunkToOriginal(change, origModel, modModel)

    expect(origModel.pushEditOperations).toHaveBeenCalledTimes(1)
    // When appending after last line, newText should be prefixed with \n
    expect(origModel._pushEditCalls[0].text).toBe('\nappended line')
  })

  it('handles deletion of entire file content', () => {
    const origModel = makeMockModel('single line')
    const modModel = makeMockModel('')

    const change: LineChange = {
      originalStartLineNumber: 1,
      originalEndLineNumber: 1,
      modifiedStartLineNumber: 0,
      modifiedEndLineNumber: 0,
    }

    applyHunkToOriginal(change, origModel, modModel)

    expect(origModel.pushEditOperations).toHaveBeenCalledTimes(1)
    expect(origModel._pushEditCalls[0].text).toBe('')
  })
})
