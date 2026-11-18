import { memo, type ReactElement, type ReactNode } from 'react'
import { EraserIcon, ImageIcon, ProhibitIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { formatBytes, type HexDumpRow } from '../../../lib/blob-utils'
import {
  HEX_DUMP_GROUP_SIZE,
  HEX_PREVIEW_BYTE_LIMIT,
  TEXT_PREVIEW_BYTE_LIMIT,
  hasBytes,
  isTruncatedPreview,
  previewBytes,
  type BlobTab,
  type BytesPreview,
  type WorkingValue,
} from './blob-working-value'
import { joinClassNames, SCROLLBAR } from '../../../lib/class-names'
import { InfoBar } from '../../common/InfoBar'
import {
  HEX_ROWS_PER_FRAME,
  TEXT_CHUNKS_PER_FRAME,
  hexPreviewRows,
  textPreviewChunks,
} from './blob-preview-content'
import { useProgressiveReveal } from './use-progressive-reveal'

type StateTone = 'null' | 'muted' | 'warning'

const STATE_TONE_CLASSES: Record<StateTone, string> = {
  null: 'text-light-outline dark:text-dark-outline',
  muted: 'text-light-on-surface-variant dark:text-dark-on-surface-variant',
  warning: 'text-light-warning dark:text-dark-warning',
}

function stateClassName(tone: StateTone): string {
  return joinClassNames([
    'flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center',
    STATE_TONE_CLASSES[tone],
  ])
}

const SKELETON_BAR_WIDTHS = ['', 'w-4/5', 'w-3/5']

type SkeletonSize = 'fill' | 'footer'

const SKELETON_SIZE_CLASSES: Record<SkeletonSize, string> = {
  fill: 'flex-1',
  footer: 'shrink-0',
}

interface LoadingSkeletonProps {
  size: SkeletonSize
  testId: string
}

function LoadingSkeleton({ size, testId }: LoadingSkeletonProps) {
  return (
    <div
      className={joinClassNames(['flex flex-col gap-3 p-4', SKELETON_SIZE_CLASSES[size]])}
      data-testid={testId}
      aria-label="Loading"
    >
      {SKELETON_BAR_WIDTHS.map((widthClassName) => (
        <div
          key={widthClassName}
          className={joinClassNames([
            'h-4 rounded-control bg-light-fill-neutral-selected dark:bg-dark-fill-neutral-selected',
            widthClassName,
          ])}
        />
      ))}
    </div>
  )
}

interface RevealingContentProps {
  isComplete: boolean
  children: ReactNode
}

function RevealingContent({ isComplete, children }: RevealingContentProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {children}
      {isComplete ? null : <LoadingSkeleton size="footer" testId="blob-preview-loading" />}
    </div>
  )
}

interface BlobPreviewSource {
  objectUrl: string | null
  columnLabel: string
}

interface BytesPanelProps extends BlobPreviewSource {
  bytes: Uint8Array
}

interface TruncatedPreviewFrameProps {
  preview: BytesPreview
  children: ReactNode
}

function truncatedPreviewMessage(preview: BytesPreview): string {
  const shownSize = formatBytes(preview.bytes.length)
  const totalSize = formatBytes(preview.totalByteCount)
  return `Showing the first ${shownSize} of ${totalSize}. Save to file to see the full content.`
}

function TruncatedPreviewFrame({ preview, children }: TruncatedPreviewFrameProps) {
  if (!isTruncatedPreview(preview)) return <>{children}</>
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <InfoBar
        severity="info"
        polite
        className="mx-4 mt-3"
        data-testid="blob-preview-truncated"
        message={truncatedPreviewMessage(preview)}
      />
      {children}
    </div>
  )
}

function ImagePanel({ objectUrl, columnLabel }: BytesPanelProps) {
  if (!objectUrl) {
    return (
      <div className={stateClassName('muted')} data-testid="blob-not-image">
        <ImageIcon size={40} weight="thin" />
        <span className="text-size-caption font-semibold">Not a valid image</span>
      </div>
    )
  }
  return (
    <div className="flex flex-1 items-center justify-center p-4" data-testid="blob-image">
      <img
        className="max-h-full max-w-full object-contain"
        src={objectUrl}
        alt={`${columnLabel} contents`}
      />
    </div>
  )
}

const TextChunk = memo(function TextChunk({ chunk }: { chunk: string }) {
  return <span className="block">{chunk}</span>
})

const HexRow = memo(function HexRow({ row }: { row: HexDumpRow }) {
  return (
    <div className="flex gap-4 whitespace-pre">
      <span className="text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {row.offset}
      </span>
      <span className="flex gap-3 text-light-on-surface dark:text-dark-on-surface">
        <span className="whitespace-pre">
          {row.hexBytes.slice(0, HEX_DUMP_GROUP_SIZE).join(' ')}
        </span>
        <span className="whitespace-pre">{row.hexBytes.slice(HEX_DUMP_GROUP_SIZE).join(' ')}</span>
      </span>
      <span className="text-light-on-surface-variant dark:text-dark-on-surface-variant">
        {row.ascii}
      </span>
    </div>
  )
})

function TextPanel({ bytes }: BytesPanelProps) {
  const preview = previewBytes(bytes, TEXT_PREVIEW_BYTE_LIMIT)
  const reveal = useProgressiveReveal({
    bytes: bytes,
    buildItems: textPreviewChunks,
    itemsPerFrame: TEXT_CHUNKS_PER_FRAME,
  })
  return (
    <TruncatedPreviewFrame preview={preview}>
      <RevealingContent isComplete={reveal.isComplete}>
        <pre
          className={joinClassNames([
            'flex-1 overflow-auto px-4 py-3 font-mono text-size-caption leading-5 whitespace-pre-wrap wrap-anywhere text-light-on-surface dark:text-dark-on-surface',
            SCROLLBAR,
          ])}
          data-testid="blob-text"
        >
          {reveal.visibleItems.map((chunk, chunkIndex) => (
            <TextChunk key={chunkIndex} chunk={chunk} />
          ))}
        </pre>
      </RevealingContent>
    </TruncatedPreviewFrame>
  )
}

function HexPanel({ bytes }: BytesPanelProps) {
  const preview = previewBytes(bytes, HEX_PREVIEW_BYTE_LIMIT)
  const reveal = useProgressiveReveal({
    bytes: bytes,
    buildItems: hexPreviewRows,
    itemsPerFrame: HEX_ROWS_PER_FRAME,
  })
  return (
    <TruncatedPreviewFrame preview={preview}>
      <RevealingContent isComplete={reveal.isComplete}>
        <div
          className="flex-1 px-4 py-3 font-mono text-size-caption leading-5"
          data-testid="blob-hex"
        >
          {reveal.visibleItems.map((row) => (
            <HexRow key={row.offset} row={row} />
          ))}
        </div>
      </RevealingContent>
    </TruncatedPreviewFrame>
  )
}

const BYTES_PANELS: Record<BlobTab, (props: BytesPanelProps) => ReactElement> = {
  image: ImagePanel,
  text: TextPanel,
  hex: HexPanel,
}

interface BlobPanelBodyProps extends BlobPreviewSource {
  loading: boolean
  working: WorkingValue | null
  activeTab: BlobTab
}

export function BlobPanelBody({ loading, working, activeTab, ...bytesPanel }: BlobPanelBodyProps) {
  const isAwaitingValue = loading || !working
  if (isAwaitingValue) {
    return <LoadingSkeleton size="fill" testId="blob-loading" />
  }
  if (working.kind === 'tooLarge') {
    return (
      <div className={stateClassName('warning')} data-testid="blob-too-large-content">
        <WarningCircleIcon size={40} weight="thin" />
        <span className="text-size-caption font-semibold">Preview limit reached</span>
        <span className="max-w-state-message text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
          Exceeds the 10 MB preview limit. Save to file to access the full content.
        </span>
      </div>
    )
  }
  if (working.kind === 'null') {
    return (
      <div className={stateClassName('null')} data-testid="blob-null-state">
        <ProhibitIcon size={40} weight="thin" />
        <span className="text-size-caption font-semibold">NULL value</span>
        <span className="max-w-state-message text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant">
          This cell contains no data.
        </span>
      </div>
    )
  }
  if (!hasBytes(working.bytes)) {
    return (
      <div className={stateClassName('muted')} data-testid="blob-empty-state">
        <EraserIcon size={40} weight="thin" />
        <span className="text-size-caption font-semibold">Empty — {formatBytes(0)}</span>
      </div>
    )
  }
  const BytesPanel = BYTES_PANELS[activeTab]
  return <BytesPanel {...bytesPanel} bytes={working.bytes} />
}
