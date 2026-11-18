import { useEffect, useState } from 'react'

export interface ProgressiveRevealRequest<TItem> {
  bytes: Uint8Array
  buildItems: (bytes: Uint8Array) => TItem[]
  itemsPerFrame: number
}

export interface ProgressiveReveal<TItem> {
  visibleItems: TItem[]
  isComplete: boolean
}

class RevealProgress<TItem> {
  readonly items: TItem[]
  readonly shownCount: number

  constructor(items: TItem[], shownCount: number) {
    this.items = items
    this.shownCount = shownCount
  }

  static start<TItem>(items: TItem[]): RevealProgress<TItem> {
    return new RevealProgress(items, 0)
  }

  revealNext(itemCount: number): RevealProgress<TItem> {
    const nextShownCount = Math.min(this.items.length, this.shownCount + itemCount)
    return new RevealProgress(this.items, nextShownCount)
  }

  get isComplete(): boolean {
    return this.shownCount >= this.items.length
  }

  toReveal(): ProgressiveReveal<TItem> {
    return { visibleItems: this.items.slice(0, this.shownCount), isComplete: this.isComplete }
  }
}

interface RevealState<TItem> {
  bytes: Uint8Array
  progress: RevealProgress<TItem>
}

const NOT_STARTED: ProgressiveReveal<never> = { visibleItems: [], isComplete: false }

function nextProgress<TItem>(
  current: RevealProgress<TItem> | null,
  request: ProgressiveRevealRequest<TItem>
): RevealProgress<TItem> {
  const started = current ?? RevealProgress.start(request.buildItems(request.bytes))
  return started.revealNext(request.itemsPerFrame)
}

export function useProgressiveReveal<TItem>(
  request: ProgressiveRevealRequest<TItem>
): ProgressiveReveal<TItem> {
  const { bytes, buildItems, itemsPerFrame } = request
  const [state, setState] = useState<RevealState<TItem> | null>(null)

  useEffect(() => {
    let progress: RevealProgress<TItem> | null = null
    let frameId = 0

    function revealNextFrame() {
      progress = nextProgress(progress, {
        bytes: bytes,
        buildItems: buildItems,
        itemsPerFrame: itemsPerFrame,
      })
      setState({ bytes: bytes, progress: progress })
      if (progress.isComplete) return
      frameId = requestAnimationFrame(revealNextFrame)
    }

    frameId = requestAnimationFrame(revealNextFrame)
    return () => cancelAnimationFrame(frameId)
  }, [bytes, buildItems, itemsPerFrame])

  const isStateForBytes = state?.bytes === bytes
  if (!isStateForBytes) return NOT_STARTED
  return state.progress.toReveal()
}
