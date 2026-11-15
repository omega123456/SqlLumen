import type { ReactElement } from 'react'
import { EraserIcon, ImageIcon, ProhibitIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { formatBytes, formatHexDump } from '../../../lib/blob-utils'
import {
  HEX_DUMP_GROUP_SIZE,
  hasBytes,
  type BlobTab,
  type WorkingValue,
} from './blob-working-value'
import { joinClassNames, SCROLLBAR } from '../../../lib/class-names'

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

interface BytesPanelProps {
  objectUrl: string | null
  columnLabel: string
  textContent: string
  hexRows: ReturnType<typeof formatHexDump>
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

function TextPanel({ textContent }: BytesPanelProps) {
  return (
    <pre
      className={joinClassNames([
        'flex-1 overflow-auto px-4 py-3 font-mono text-size-caption leading-5 whitespace-pre-wrap wrap-anywhere text-light-on-surface dark:text-dark-on-surface',
        SCROLLBAR,
      ])}
      data-testid="blob-text"
    >
      {textContent}
    </pre>
  )
}

function HexPanel({ hexRows }: BytesPanelProps) {
  return (
    <div className="flex-1 px-4 py-3 font-mono text-size-caption leading-5" data-testid="blob-hex">
      {hexRows.map((row) => (
        <div className="flex gap-4 whitespace-pre" key={row.offset}>
          <span className="text-light-on-surface-variant dark:text-dark-on-surface-variant">
            {row.offset}
          </span>
          <span className="flex gap-3 text-light-on-surface dark:text-dark-on-surface">
            <span className="whitespace-pre">
              {row.hexBytes.slice(0, HEX_DUMP_GROUP_SIZE).join(' ')}
            </span>
            <span className="whitespace-pre">
              {row.hexBytes.slice(HEX_DUMP_GROUP_SIZE).join(' ')}
            </span>
          </span>
          <span className="text-light-on-surface-variant dark:text-dark-on-surface-variant">
            {row.ascii}
          </span>
        </div>
      ))}
    </div>
  )
}

const BYTES_PANELS: Record<BlobTab, (props: BytesPanelProps) => ReactElement> = {
  image: ImagePanel,
  text: TextPanel,
  hex: HexPanel,
}

interface BlobPanelBodyProps extends BytesPanelProps {
  loading: boolean
  working: WorkingValue | null
  activeTab: BlobTab
}

export function BlobPanelBody({ loading, working, activeTab, ...bytesPanel }: BlobPanelBodyProps) {
  const isAwaitingValue = loading || !working
  if (isAwaitingValue) {
    return (
      <div
        className="flex flex-1 flex-col gap-3 p-4"
        data-testid="blob-loading"
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
  return <BytesPanel {...bytesPanel} />
}
