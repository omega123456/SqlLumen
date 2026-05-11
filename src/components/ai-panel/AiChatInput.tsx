import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react'
import { PaperPlaneRight, Stop, X } from '@phosphor-icons/react'
import { useAiStore } from '../../stores/ai-store'
import { useSettingsStore } from '../../stores/settings-store'
import { filterCommands, findCommand } from '../../lib/slash-commands'
import { showErrorToast } from '../../stores/toast-store'
import { Textarea } from '../common/Textarea'
import { Button } from '../common/Button'
import { IconButton } from '../common/IconButton'
import { SlashCommandDropdown } from './SlashCommandDropdown'
import type { SlashCommand } from '../../lib/slash-commands'
import styles from './AiChatInput.module.css'

import { logFrontend } from '../../lib/app-log-commands'
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
  const [showDropdown, setShowDropdown] = useState(false)
  const [filteredCmds, setFilteredCmds] = useState<SlashCommand[]>([])
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
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
      const frame = requestAnimationFrame(() => {
        setValue(suggestionText)
        onSuggestionConsumed?.()
        textareaRef.current?.focus()
      })

      return () => cancelAnimationFrame(frame)
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

  const updateDropdown = useCallback((text: string) => {
    if (text.startsWith('/') && !text.includes(' ')) {
      const prefix = text.slice(1)
      const cmds = filterCommands(prefix)
      setFilteredCmds(cmds)
      setShowDropdown(cmds.length > 0)
      setHighlightedIndex(-1)
    } else {
      setShowDropdown(false)
      setFilteredCmds([])
      setHighlightedIndex(-1)
    }
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value
      setValue(newValue)
      updateDropdown(newValue)
    },
    [updateDropdown]
  )

  const selectCommand = useCallback((cmd: SlashCommand) => {
    const newValue = `/${cmd.name} `
    setValue(newValue)
    setShowDropdown(false)
    setFilteredCmds([])
    setHighlightedIndex(-1)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(newValue.length, newValue.length)
      }
    })
  }, [])

  const resetHeight = useCallback(() => {
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.style.height = `${MIN_TEXTAREA_HEIGHT_PX}px`
      }
    })
  }, [])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || !canSend) {
      return
    }

    // Check for slash command
    const slashMatch = trimmed.match(/^\/(\S+)\s*(.*)$/)
    if (slashMatch) {
      const [, cmdName, cmdArgs] = slashMatch
      const cmd = findCommand(cmdName)
      if (cmd) {
        if (!connectionId) {
          showErrorToast('No active connection')
          return
        }
        const savedValue = value
        cmd
          .execute(cmdArgs, connectionId)
          .then(() => {
            setValue('')
            resetHeight()
          })
          .catch((err: unknown) => {
            // Restore input on failure
            setValue(savedValue)
            logFrontend(
              'warn',
              `[AiChatInput] slash command /${cmdName} rejected: ${err instanceof Error ? err.message : String(err)}`
            )
          })
        return
      }
    }

    if (!connectionId) {
      return
    }

    useAiStore.getState().sendMessage(tabId, connectionId, trimmed, {})
    setValue('')
    resetHeight()
  }, [value, connectionId, canSend, tabId, resetHeight])

  const handleCancel = useCallback(() => {
    useAiStore.getState().cancelStream(tabId)
  }, [tabId])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (showDropdown) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setHighlightedIndex((prev) => (prev < filteredCmds.length - 1 ? prev + 1 : 0))
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredCmds.length - 1))
          return
        }
        if (e.key === 'Enter' && !e.shiftKey && highlightedIndex >= 0) {
          e.preventDefault()
          selectCommand(filteredCmds[highlightedIndex])
          return
        }
        if (e.key === 'Tab' && highlightedIndex >= 0) {
          e.preventDefault()
          selectCommand(filteredCmds[highlightedIndex])
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowDropdown(false)
          return
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [showDropdown, filteredCmds, highlightedIndex, selectCommand, handleSend]
  )

  const handleRemoveContext = useCallback(() => {
    useAiStore.getState().clearAttachedContext(tabId)
  }, [tabId])

  return (
    <div className={styles.container} data-testid="ai-chat-input">
      <div className={styles.textareaWrapper}>
        {showDropdown && (
          <SlashCommandDropdown
            commands={filteredCmds}
            highlightedIndex={highlightedIndex}
            onSelect={selectCommand}
            onHighlightChange={setHighlightedIndex}
          />
        )}
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
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          role={showDropdown ? 'combobox' : undefined}
          aria-expanded={showDropdown ? true : undefined}
          aria-controls={showDropdown ? 'slash-command-listbox' : undefined}
          aria-activedescendant={
            showDropdown && highlightedIndex >= 0
              ? `slash-cmd-${filteredCmds[highlightedIndex]?.name}`
              : undefined
          }
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
