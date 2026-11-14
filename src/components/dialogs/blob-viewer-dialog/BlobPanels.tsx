import type { ReactElement } from 'react'
import { EraserIcon, ImageIcon, ProhibitIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { formatBytes, formatHexDump } from '../../../lib/blob-utils'
import {
  HEX_DUMP_GROUP_SIZE,
  hasBytes,
  type BlobTab,
  type WorkingValue,
} from './blob-working-value'
import styles from '../BlobViewerDialog.module.css'

interface BytesPanelProps {
  objectUrl: string | null
  columnLabel: string
  textContent: string
  hexRows: ReturnType<typeof formatHexDump>
}

function ImagePanel({ objectUrl, columnLabel }: BytesPanelProps) {
  if (!objectUrl) {
    return (
      <div className={styles.notImageState} data-testid="blob-not-image">
        <ImageIcon size={40} weight="thin" />
        <span className={styles.stateTitle}>Not a valid image</span>
      </div>
    )
  }
  return (
    <div className={styles.imagePanel} data-testid="blob-image">
      <img className={styles.image} src={objectUrl} alt={`${columnLabel} contents`} />
    </div>
  )
}

function TextPanel({ textContent }: BytesPanelProps) {
  return (
    <pre className={styles.textPanel} data-testid="blob-text">
      {textContent}
    </pre>
  )
}

function HexPanel({ hexRows }: BytesPanelProps) {
  return (
    <div className={styles.hexPanel} data-testid="blob-hex">
      {hexRows.map((row) => (
        <div className={styles.hexRow} key={row.offset}>
          <span className={styles.hexOffset}>{row.offset}</span>
          <span className={styles.hexBytes}>
            <span className={styles.hexGroup}>
              {row.hexBytes.slice(0, HEX_DUMP_GROUP_SIZE).join(' ')}
            </span>
            <span className={styles.hexGroup}>
              {row.hexBytes.slice(HEX_DUMP_GROUP_SIZE).join(' ')}
            </span>
          </span>
          <span className={styles.hexAscii}>{row.ascii}</span>
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
      <div className={styles.skeleton} data-testid="blob-loading" aria-label="Loading">
        <div className={styles.skeletonBar} />
        <div className={styles.skeletonBar} />
        <div className={styles.skeletonBar} />
      </div>
    )
  }
  if (working.kind === 'tooLarge') {
    return (
      <div className={styles.warningState} data-testid="blob-too-large-content">
        <WarningCircleIcon size={40} weight="thin" />
        <span className={styles.stateTitle}>Preview limit reached</span>
        <span className={styles.stateSub}>
          Exceeds the 10 MB preview limit. Save to file to access the full content.
        </span>
      </div>
    )
  }
  if (working.kind === 'null') {
    return (
      <div className={styles.nullState} data-testid="blob-null-state">
        <ProhibitIcon size={40} weight="thin" />
        <span className={styles.stateTitle}>NULL value</span>
        <span className={styles.stateSub}>This cell contains no data.</span>
      </div>
    )
  }
  if (!hasBytes(working.bytes)) {
    return (
      <div className={styles.emptyState} data-testid="blob-empty-state">
        <EraserIcon size={40} weight="thin" />
        <span className={styles.stateTitle}>Empty — {formatBytes(0)}</span>
      </div>
    )
  }
  const BytesPanel = BYTES_PANELS[activeTab]
  return <BytesPanel {...bytesPanel} />
}
