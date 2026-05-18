import React from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessRow } from '../../../lib/processlist-commands'
import * as CanvasBaseGridViewModule from '../../../components/shared/glide/CanvasBaseGridView'
import * as InfoCellPopoverModule from '../../../components/processlist/InfoCellPopover'

// CanvasBaseGridView is a forwardRef object — vi.spyOn can't intercept it.
// Use Object.defineProperty to replace it per-test (same pattern as ResultGridView.test.tsx).

const originalCanvasBaseGridView = CanvasBaseGridViewModule.CanvasBaseGridView

type ProcessListTestApi = {
  openInfoPopover?: (connectionId: string, rowIndex: number) => boolean
  sentinel?: string
}

const mockCanvasBaseGridView = vi.fn()

function applyCanvasBaseGridViewMock(module: typeof CanvasBaseGridViewModule) {
  const mockFn = mockCanvasBaseGridView
  Object.defineProperty(module, 'CanvasBaseGridView', {
    value: React.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<unknown>) => {
        mockFn(props)

        const hostRef = React.useRef<HTMLDivElement>(null)

        React.useImperativeHandle(ref, () => ({
          element: hostRef.current,
        }))

        React.useLayoutEffect(() => {
          const host = hostRef.current
          if (!host) return

          host.dataset.glideColumnWidth = '[10,20,30,40,50,60,70,80]'
          host.dataset.rowMarkerWidth = '32'
          host.getBoundingClientRect = () =>
            ({
              x: 100,
              y: 200,
              top: 200,
              left: 100,
              right: 900,
              bottom: 500,
              width: 800,
              height: 300,
              toJSON: () => ({}),
            }) as DOMRect

          const scroller = host.querySelector('.dvn-scroller') as HTMLDivElement | null
          if (!scroller) return

          Object.defineProperty(scroller, 'scrollLeft', {
            configurable: true,
            value: 15,
            writable: true,
          })
          Object.defineProperty(scroller, 'scrollTop', {
            configurable: true,
            value: 5,
            writable: true,
          })
        })

        return (
          <div
            data-testid="mock-canvas-grid"
            data-row-count={(props.rows as unknown[])?.length ?? 0}
            ref={hostRef}
          >
            <div className="dvn-scroller" />
          </div>
        )
      }
    ),
    writable: true,
    configurable: true,
  })
}

function applyInfoCellPopoverMock(module: typeof InfoCellPopoverModule) {
  vi.spyOn(module, 'InfoCellPopover').mockImplementation(
    ({ sql, anchorRect }: { sql: string | null; anchorRect?: DOMRect | null }) =>
      sql ? (
        <div
          data-testid="info-popover"
          data-anchor-left={String(anchorRect?.x ?? '')}
          data-anchor-top={String(anchorRect?.y ?? '')}
          data-anchor-width={String(anchorRect?.width ?? '')}
          data-anchor-height={String(anchorRect?.height ?? '')}
        >
          {sql}
        </div>
      ) : null
  )
}

const rows: ProcessRow[] = [
  {
    id: 2,
    user: 'bob',
    host: 'h2',
    db: 'app',
    command: 'Query',
    time: 4,
    state: 'run',
    info: 'SELECT 2',
  },
  {
    id: 1,
    user: 'ada',
    host: 'h1',
    db: null,
    command: 'Sleep',
    time: 9,
    state: null,
    info: '',
  },
]

async function loadPlaywrightModules() {
  vi.resetModules()
  vi.stubEnv('VITE_PLAYWRIGHT', 'true')

  const [{ ProcessListGridView }, { useProcessListStore }, canvasMod, infoMod] = await Promise.all([
    import('../../../components/processlist/ProcessListGridView'),
    import('../../../stores/processlist-store'),
    import('../../../components/shared/glide/CanvasBaseGridView'),
    import('../../../components/processlist/InfoCellPopover'),
  ])

  // Apply mocks to the newly-loaded module instances (vi.resetModules creates fresh instances)
  applyCanvasBaseGridViewMock(canvasMod as typeof CanvasBaseGridViewModule)
  applyInfoCellPopoverMock(infoMod as typeof InfoCellPopoverModule)

  return { ProcessListGridView, useProcessListStore }
}

function getProcessListTestApi(): ProcessListTestApi | undefined {
  return (window as typeof window & { __processListTestApi__?: ProcessListTestApi })
    .__processListTestApi__
}

describe('ProcessListGridView Playwright helpers', () => {
  beforeEach(() => {
    mockCanvasBaseGridView.mockClear()
    applyCanvasBaseGridViewMock(CanvasBaseGridViewModule)
    applyInfoCellPopoverMock(InfoCellPopoverModule)
    delete (window as typeof window & { __processListTestApi__?: ProcessListTestApi })
      .__processListTestApi__
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    Object.defineProperty(CanvasBaseGridViewModule, 'CanvasBaseGridView', {
      value: originalCanvasBaseGridView,
      writable: true,
      configurable: true,
    })
    delete (window as typeof window & { __processListTestApi__?: ProcessListTestApi })
      .__processListTestApi__
  })

  it('registers a Playwright API that opens the info popover with a computed anchor rect', async () => {
    const { ProcessListGridView, useProcessListStore } = await loadPlaywrightModules()

    act(() => {
      useProcessListStore.setState({
        rowsByConnection: { c1: rows },
        selectedIdsByConnection: {},
        excludeIdleConnectionsByConnection: { c1: false },
        sortColumnByConnection: {},
      })
    })

    render(<ProcessListGridView connectionId="c1" />)

    const api = getProcessListTestApi()
    expect(api?.openInfoPopover).toBeTypeOf('function')

    let opened = false
    act(() => {
      opened = api?.openInfoPopover?.('c1', 0) ?? false
    })

    expect(opened).toBe(true)
    expect(screen.getByTestId('info-popover')).toHaveTextContent('SELECT 2')
    expect(screen.getByTestId('info-popover')).toHaveAttribute('data-anchor-left', '397')
    expect(screen.getByTestId('info-popover')).toHaveAttribute('data-anchor-top', '227')
    expect(screen.getByTestId('info-popover')).toHaveAttribute('data-anchor-width', '80')
    expect(screen.getByTestId('info-popover')).toHaveAttribute('data-anchor-height', '32')
  })

  it('returns false for mismatched targets and removes the Playwright API on unmount', async () => {
    const { ProcessListGridView, useProcessListStore } = await loadPlaywrightModules()

    act(() => {
      useProcessListStore.setState({
        rowsByConnection: { c1: rows },
        selectedIdsByConnection: {},
        excludeIdleConnectionsByConnection: { c1: false },
        sortColumnByConnection: {},
      })
    })

    const { unmount } = render(<ProcessListGridView connectionId="c1" />)

    const api = getProcessListTestApi()
    expect(api?.openInfoPopover?.('other-connection', 0)).toBe(false)
    expect(api?.openInfoPopover?.('c1', 1)).toBe(false)
    expect(screen.queryByTestId('info-popover')).toBeNull()

    unmount()

    expect(getProcessListTestApi()).toBeUndefined()
  })

  it('falls back to a default anchor rect and preserves existing Playwright API keys', async () => {
    const { ProcessListGridView, useProcessListStore } = await loadPlaywrightModules()

    ;(
      window as typeof window & { __processListTestApi__?: ProcessListTestApi }
    ).__processListTestApi__ = {
      sentinel: 'keep-me',
    }

    act(() => {
      useProcessListStore.setState({
        rowsByConnection: { c1: rows },
        selectedIdsByConnection: {},
        excludeIdleConnectionsByConnection: { c1: false },
        sortColumnByConnection: {},
      })
    })

    const { unmount } = render(<ProcessListGridView connectionId="c1" />)

    const host = screen.getByTestId('mock-canvas-grid')
    host.setAttribute('data-glide-column-width', '[]')

    let opened = false
    act(() => {
      opened = getProcessListTestApi()?.openInfoPopover?.('c1', 0) ?? false
    })

    expect(opened).toBe(true)
    expect(screen.getByTestId('info-popover')).toHaveAttribute('data-anchor-left', '320')
    expect(screen.getByTestId('info-popover')).toHaveAttribute('data-anchor-top', '200')
    expect(screen.getByTestId('info-popover')).toHaveAttribute('data-anchor-width', '260')
    expect(screen.getByTestId('info-popover')).toHaveAttribute('data-anchor-height', '36')

    unmount()

    expect(getProcessListTestApi()).toEqual({ sentinel: 'keep-me' })
  })
})
