import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react'
import { PaperPlaneRight, Stop, X } from '@phosphor-icons/react'
import { useAiStore } from '../../stores/ai-store'
import { useSettingsStore } from '../../stores/settings-store'
import { Textarea } from '../common/Textarea'
import { Button } from '../common/Button'
import { IconButton } from '../common/IconButton'
import styles from './AiChatInput.module.css'

const MIN_TEXTAREA_HEIGHT_PX = 36
const MAX_TEXTAREA_HEIGHT_PX = 140

export interface AiChatInputProps {
  tabId: string
  connectionId: string | null
  /** External text to fill into the textarea (e.g. from suggestion chip). */
  suggestionText?: string
  /** Called after the suggestion text has been consumed. */
  onSuggestionConsumed?: () => void
  /** When true, the entire input is disabled (no typing, no sending). */
  disabled?: boolean
  /** Override the default placeholder text. */
  placeholder?: string
}

export function AiChatInput({
  tabId,
  connectionId,
  suggestionText,
  onSuggestionConsumed,
  disabled: externalDisabled,
  placeholder: externalPlaceholder,
}: AiChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isGenerating = useAiStore((s) => s.tabs[tabId]?.isGenerating ?? false)
  const attachedContext = useAiStore((s) => s.tabs[tabId]?.attachedContext ?? null)

  const aiEnabled = useSettingsStore(
    (s) => (s.pendingChanges['ai.enabled'] ?? s.settings['ai.enabled'] ?? 'false') === 'true'
  )
  const hasEndpoint = useSettingsStore(
    (s) => !!(s.pendingChanges['ai.endpoint'] ?? s.settings['ai.endpoint'] ?? '')
  )
  const hasModel = useSettingsStore(
    (s) => !!(s.pendingChanges['ai.model'] ?? s.settings['ai.model'] ?? '')
  )

  const canSend =
    !externalDisabled &&
    aiEnabled &&
    hasEndpoint &&
    hasModel &&
    value.trim().length > 0 &&
    !isGenerating

  // Consume external suggestion text
  useEffect(() => {
    if (suggestionText) {
      setValue(suggestionText)
      onSuggestionConsumed?.()
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    }
  }, [suggestionText, onSuggestionConsumed])

  // Auto-expand textarea based on content
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) {
      return
    }
    if (value.length === 0) {
      el.style.height = `${MIN_TEXTAREA_HEIGHT_PX}px`
      return
    }
    el.style.height = 'auto'
    el.style.height = `${Math.min(
      Math.max(el.scrollHeight, MIN_TEXTAREA_HEIGHT_PX),
      MAX_TEXTAREA_HEIGHT_PX
    )}px`
  }, [value])

  useEffect(() => {
    adjustHeight()
  }, [value, adjustHeight])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || !connectionId || !canSend) {
      return
    }

    useAiStore.getState().sendMessage(tabId, connectionId, trimmed, {})
    setValue('')

    // Reset textarea height after clearing
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.style.height = `${MIN_TEXTAREA_HEIGHT_PX}px`
      }
    })
  }, [value, connectionId, canSend, tabId])

  const handleCancel = useCallback(() => {
    useAiStore.getState().cancelStream(tabId)
  }, [tabId])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const handleRemoveContext = useCallback(() => {
    useAiStore.getState().clearAttachedContext(tabId)
  }, [tabId])

  return (
    <div className={styles.container} data-testid="ai-chat-input">
      <div className={styles.textareaWrapper}>
        {attachedContext && (
          <div className={styles.contextChip} data-testid="ai-context-chip">
            <span className={styles.contextChipText} title={attachedContext.sql}>
              {attachedContext.sql.length > 60
                ? attachedContext.sql.slice(0, 57) + '...'
                : attachedContext.sql}
            </span>
            <IconButton
              size="sm"
              className={styles.contextChipRemove}
              onClick={handleRemoveContext}
              title="Remove context"
              aria-label="Remove attached SQL context"
              data-testid="ai-context-chip-remove"
            >
              <X size={12} />
            </IconButton>
          </div>
        )}
        <Textarea
          ref={textareaRef}
          variant="bare"
          className={styles.textarea}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            externalPlaceholder
              ? externalPlaceholder
              : !aiEnabled
                ? 'AI is disabled — enable it in Settings'
                : !hasEndpoint || !hasModel
                  ? 'Configure AI endpoint and model in Settings'
                  : 'Ask about your database...'
          }
          disabled={externalDisabled || isGenerating}
          rows={1}
          data-testid="ai-chat-textarea"
        />
      </div>

      {isGenerating ? (
        <Button
          variant="danger"
          className={styles.stopButton}
          onClick={handleCancel}
          title="Stop generation"
          aria-label="Stop generation"
          data-testid="ai-stop-button"
        >
          <Stop size={18} weight="fill" />
        </Button>
      ) : (
        <Button
          variant="primary"
          className={styles.sendButton}
          onClick={handleSend}
          disabled={!canSend}
          title="Send message"
          aria-label="Send message"
          data-testid="ai-send-button"
        >
          <PaperPlaneRight size={18} weight="fill" />
        </Button>
      )}
    </div>
  )
}
