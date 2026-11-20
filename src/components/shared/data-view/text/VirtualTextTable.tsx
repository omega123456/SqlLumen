import { memo, useRef, useState } from 'react'
import { joinClassNames, SCROLLBAR } from '../../../../lib/class-names'
import { readPixelToken } from '../../../../lib/theme-tokens'
import type { TextTableLayout } from '../text-format'
import { LINES_PER_BLOCK, useVisibleTextWindow, type TextSpan } from './use-visible-text-window'

const FALLBACK_LINE_HEIGHT_PX = 21

export type TextTableTopSpacing = 'strip' | 'floating-copy'

const HEADER_TOP_SPACING: Record<TextTableTopSpacing, string> = {
  strip: 'pt-4',
  'floating-copy': 'pt-11',
}

interface VirtualTextTableProps {
  layout: TextTableLayout
  topSpacing: TextTableTopSpacing
  isBusy: boolean
}

function readLineHeight(): number {
  return readPixelToken('--text-mono-relaxed--line-height', FALLBACK_LINE_HEIGHT_PX)
}

function sliceOf(line: string, characters: TextSpan): string {
  return line.slice(characters.first, characters.end)
}

function blockStartsOf(lines: TextSpan): number[] {
  const blockStarts: number[] = []
  for (let blockStart = lines.first; blockStart < lines.end; blockStart += LINES_PER_BLOCK) {
    blockStarts.push(blockStart)
  }
  return blockStarts
}

function blockRowIndices(blockStart: number, rowCount: number): number[] {
  const blockEnd = Math.min(blockStart + LINES_PER_BLOCK, rowCount)
  return Array.from({ length: blockEnd - blockStart }, (_, offset) => blockStart + offset)
}

interface TextHeaderLineProps {
  layout: TextTableLayout
  characters: TextSpan
  topSpacing: TextTableTopSpacing
}

function TextHeaderLine({ layout, characters, topSpacing }: TextHeaderLineProps) {
  return (
    <div
      className={joinClassNames([
        'sticky top-0 z-1 border-b border-b-light-stroke-divider bg-light-surface-container-low px-4 pb-1 dark:border-b-dark-stroke-divider dark:bg-dark-surface-container-low',
        HEADER_TOP_SPACING[topSpacing],
      ])}
      data-testid="text-view-header"
    >
      <div style={{ paddingLeft: `${characters.first}ch`, width: `${layout.lineLength}ch` }}>
        {sliceOf(layout.headerLine(), characters)}
      </div>
    </div>
  )
}

interface TextBlockProps {
  layout: TextTableLayout
  blockStart: number
  characters: TextSpan
  lineHeight: number
}

const TextBlock = memo(function TextBlock({
  layout,
  blockStart,
  characters,
  lineHeight,
}: TextBlockProps) {
  return (
    <div
      className="absolute"
      style={{ top: blockStart * lineHeight, left: `${characters.first}ch` }}
    >
      {blockRowIndices(blockStart, layout.rowCount).map((rowIndex) => (
        <div key={rowIndex} style={{ height: lineHeight }} data-testid="text-view-row">
          {sliceOf(layout.rowLine(rowIndex), characters)}
        </div>
      ))}
    </div>
  )
})

export function VirtualTextTable({ layout, topSpacing, isBusy }: VirtualTextTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const [lineHeight] = useState(readLineHeight)
  const { textWindow, onScroll } = useVisibleTextWindow({
    scrollRef: scrollRef,
    spacerRef: spacerRef,
    layout: layout,
    lineHeight: lineHeight,
  })

  return (
    <div
      ref={scrollRef}
      className={joinClassNames([
        'min-h-0 flex-1 overflow-auto font-mono text-mono-relaxed whitespace-pre text-light-on-surface select-text webkit-scrollbar:h-2 dark:text-dark-on-surface',
        SCROLLBAR,
      ])}
      onScroll={onScroll}
      aria-busy={isBusy}
      data-testid="text-view-scroller"
    >
      <div className="w-max min-w-full pb-4">
        <TextHeaderLine
          layout={layout}
          characters={textWindow.characters}
          topSpacing={topSpacing}
        />
        <div
          ref={spacerRef}
          className="relative mx-4 mt-1"
          style={{ height: layout.rowCount * lineHeight, width: `${layout.lineLength}ch` }}
        >
          {blockStartsOf(textWindow.lines).map((blockStart) => (
            <TextBlock
              key={blockStart}
              layout={layout}
              blockStart={blockStart}
              characters={textWindow.characters}
              lineHeight={lineHeight}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
