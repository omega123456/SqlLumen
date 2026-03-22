/**
 * Documentation side-panel for the Monaco autocomplete widget.
 * Renders as a portal positioned next to Monaco's suggest widget.
 * Uses MutationObserver to detect when the suggest widget is visible.
 */

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { subscribeDocItem, getDocItem } from './AutocompleteProvider'
import type { DocPanelItem } from './AutocompleteProvider'
import styles from './AutocompleteDocPanel.module.css'

interface AutocompleteDocPanelProps {
  connectionId: string
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function AutocompleteDocPanel(_props: AutocompleteDocPanelProps) {
  const [docItem, setDocItem] = useState<DocPanelItem | null>(getDocItem())
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, height: 0 })
  const observerRef = useRef<MutationObserver | null>(null)

  // Subscribe to doc item changes from the autocomplete provider
  useEffect(() => {
    const unsubscribe = subscribeDocItem((item) => {
      setDocItem(item)
    })
    return unsubscribe
  }, [])

  // Watch for Monaco's .suggest-widget visibility via MutationObserver
  useEffect(() => {
    function checkSuggestWidget() {
      const suggestWidget = document.querySelector('.suggest-widget.visible') as HTMLElement | null
      if (suggestWidget && suggestWidget.offsetHeight > 0) {
        const rect = suggestWidget.getBoundingClientRect()
        setPosition({
          top: rect.top,
          left: rect.right,
          height: rect.height,
        })
        setVisible(true)
      } else {
        setVisible(false)
      }
    }

    observerRef.current = new MutationObserver(() => {
      checkSuggestWidget()
    })

    observerRef.current.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    })

    return () => {
      observerRef.current?.disconnect()
    }
  }, [])

  if (!visible) return null

  const panel = (
    <div
      className={styles.panel}
      data-testid="autocomplete-doc-panel"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        minHeight: position.height > 0 ? position.height : undefined,
        zIndex: 10000,
      }}
    >
      <div className={styles.header}>DOCUMENTATION</div>
      {docItem ? (
        <>
          <div className={styles.name}>{docItem.name}</div>
          <div className={styles.divider} />
          {docItem.type === 'table' && docItem.tableInfo && (
            <div className={styles.meta}>
              {docItem.columnCount != null && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Columns</span>
                  <span className={styles.metaValue}>{docItem.columnCount}</span>
                </div>
              )}
              {docItem.tableInfo.engine && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Engine</span>
                  <span className={styles.metaValue}>{docItem.tableInfo.engine}</span>
                </div>
              )}
              {docItem.tableInfo.charset && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Charset</span>
                  <span className={styles.metaValue}>{docItem.tableInfo.charset}</span>
                </div>
              )}
              {docItem.tableInfo.rowCount != null && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Rows</span>
                  <span className={styles.metaValue}>
                    ~{docItem.tableInfo.rowCount.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          )}
          {docItem.type === 'column' && (
            <div className={styles.meta}>
              {docItem.table && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Table</span>
                  <span className={styles.metaValue}>{docItem.table}</span>
                </div>
              )}
              {docItem.database && (
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Database</span>
                  <span className={styles.metaValue}>{docItem.database}</span>
                </div>
              )}
            </div>
          )}
          {docItem.type === 'database' && (
            <div className={styles.meta}>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Type</span>
                <span className={styles.metaValue}>Database</span>
              </div>
            </div>
          )}
          {docItem.type === 'routine' && (
            <div className={styles.meta}>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Type</span>
                <span className={styles.metaValue}>Routine</span>
              </div>
            </div>
          )}
          {docItem.type === 'keyword' && (
            <div className={styles.meta}>
              <div className={styles.metaRow}>
                <span className={styles.metaLabel}>Type</span>
                <span className={styles.metaValue}>SQL Keyword</span>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className={styles.placeholder}>Select a suggestion to see documentation</div>
      )}
    </div>
  )

  return createPortal(panel, document.body)
}
