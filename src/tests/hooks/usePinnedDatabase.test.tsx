import { describe, it, expect, afterEach, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { findPinnedDatabaseSection, usePinnedDatabase } from '../../hooks/usePinnedDatabase'

const ROW = 28

interface SectionSpec {
  id: string
  /** Number of child rows; 0 renders a collapsed database (no group). */
  children: number
}

/** Build a scroll container with sections and give them layout via stubbed rects. */
function buildContainer(sections: SectionSpec[]): HTMLDivElement {
  const container = document.createElement('div')
  const tree = document.createElement('div')
  tree.setAttribute('role', 'tree')
  container.appendChild(tree)

  let offset = 0
  for (const spec of sections) {
    const section = document.createElement('div')
    section.dataset.databaseSection = spec.id
    const height = ROW * (spec.children + 1)
    if (spec.children > 0) {
      const group = document.createElement('div')
      group.setAttribute('role', 'group')
      section.appendChild(group)
    }
    const top = offset
    section.getBoundingClientRect = () => {
      const y = top - container.scrollTop
      return { top: y, bottom: y + height, height } as DOMRect
    }
    offset += height
    tree.appendChild(section)
  }

  container.getBoundingClientRect = () => ({ top: 0, bottom: 300, height: 300 }) as DOMRect
  return container
}

function Probe({ container }: { container: HTMLElement | null }) {
  const pinned = usePinnedDatabase(container)
  return <span data-testid="pinned">{pinned ?? 'none'}</span>
}

describe('findPinnedDatabaseSection', () => {
  it('returns null when nothing has scrolled', () => {
    const container = buildContainer([{ id: 'db-a', children: 20 }])
    expect(findPinnedDatabaseSection(container)).toBeNull()
  })

  it('returns the expanded section crossing the top edge', () => {
    const container = buildContainer([
      { id: 'db-a', children: 3 },
      { id: 'db-b', children: 30 },
    ])
    container.scrollTop = ROW * 10
    expect(findPinnedDatabaseSection(container)).toBe('db-b')
  })

  it('releases at the end of the section', () => {
    const container = buildContainer([
      { id: 'db-a', children: 3 },
      { id: 'db-b', children: 0 },
    ])
    // db-a spans 0..112; scrolled to its exact end
    container.scrollTop = ROW * 4
    expect(findPinnedDatabaseSection(container)).toBeNull()
  })

  it('never pins a collapsed database', () => {
    const container = buildContainer([
      { id: 'db-a', children: 0 },
      { id: 'db-b', children: 0 },
    ])
    container.scrollTop = 10
    expect(findPinnedDatabaseSection(container)).toBeNull()
  })
})

describe('usePinnedDatabase', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null without a container', () => {
    render(<Probe container={null} />)
    expect(screen.getByTestId('pinned')).toHaveTextContent('none')
  })

  it('updates on scroll', async () => {
    const container = buildContainer([{ id: 'db-a', children: 40 }])
    document.body.appendChild(container)

    render(<Probe container={container} />)
    await waitFor(() => expect(screen.getByTestId('pinned')).toHaveTextContent('none'))

    container.scrollTop = ROW * 5
    act(() => {
      container.dispatchEvent(new Event('scroll'))
    })
    await waitFor(() => expect(screen.getByTestId('pinned')).toHaveTextContent('db-a'))

    container.remove()
  })

  it('updates when the rows change without scrolling', async () => {
    const container = buildContainer([{ id: 'db-a', children: 40 }])
    container.scrollTop = ROW * 5
    document.body.appendChild(container)

    render(<Probe container={container} />)
    await waitFor(() => expect(screen.getByTestId('pinned')).toHaveTextContent('db-a'))

    // Collapsing removes the group
    act(() => {
      container.querySelector('[role="group"]')?.remove()
    })
    await waitFor(() => expect(screen.getByTestId('pinned')).toHaveTextContent('none'))

    container.remove()
  })

  it('stops listening after unmount', async () => {
    const container = buildContainer([{ id: 'db-a', children: 40 }])
    document.body.appendChild(container)
    const removeSpy = vi.spyOn(container, 'removeEventListener')

    function Toggle() {
      const [shown, setShown] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setShown(false)}>
            hide
          </button>
          {shown && <Probe container={container} />}
        </>
      )
    }

    render(<Toggle />)
    await waitFor(() => expect(screen.getByTestId('pinned')).toHaveTextContent('none'))
    act(() => {
      screen.getByText('hide').click()
    })

    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function))
    container.remove()
  })
})
