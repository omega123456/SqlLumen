import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react'
import { PaperPlaneRightIcon, StopIcon, XIcon } from '@phosphor-icons/react'
import { useAiStore } from '../../stores/ai-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useConnectionStore } from '../../stores/connection-store'
import { executeRemember, filterCommands, findCommand } from '../../lib/slash-commands'
import { resolveRememberScope } from '../../lib/slash-commands'
import { subscribeToTabDeactivated } from '../../lib/workspace-tab-activity-events'
import { showErrorToast } from '../../stores/toast-store'
import { Textarea } from '../common/Textarea'
import { Button } from '../common/Button'
import { IconButton } from '../common/IconButton'
import { SlashCommandDropdown } from './SlashCommandDropdown'
import { MemoryScopePicker } from './MemoryScopePicker'
import type { SlashCommand } from '../../lib/slash-commands'
import type { MemoryScope } from '../../lib/ai-memory-commands'
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
  /** Owning workspace tab, used for focus tracking and dropdown dismissal. */
  workspaceTabId?: string
}

export function AiChatInput({
  tabId,
  connectionId,
  suggestionText,
  onSuggestionConsumed,
  disabled: externalDisabled,
  placeholder: externalPlaceholder,
  workspaceTabId,
}: AiChatInputProps) {
  const [value, setValue] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [filteredCmds, setFilteredCmds] = useState<SlashCommand[]>([])
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  // When set, the "Always Ask" memory scope picker is shown above the input.
  // The string is the (trimmed) memory content awaiting a scope choice.
  const [pendingRememberContent, setPendingRememberContent] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const setLastFocusedSurface = useWorkspaceStore((s) => s.setLastFocusedSurface)

  // The active connection's group presence (the session id `connectionId` maps
  // to a saved profile via the connection store). Used to enable/disable the
  // Group option in the scope picker.
  const hasGroup = useConnectionStore(
    (s) =>
      (connectionId ? (s.activeConnections[connectionId]?.profile?.groupId ?? null) : null) !== null
  )
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
  // Saved default `/remember` scope, used to seed the scope-picker highlight.
  // Only a concrete level is passed through; `'ask'` (or anything else) lets
  // the picker fall back to Connection.
  const defaultRememberScope = useSettingsStore((s) => {
    const value = s.pendingChanges['ai.rememberScope'] ?? s.settings['ai.rememberScope']
    return value === 'connection' || value === 'group' || value === 'global'
      ? (value as MemoryScope)
      : undefined
  })

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

  useEffect(() => {
    if (!workspaceTabId) {
      return
    }

    return subscribeToTabDeactivated(workspaceTabId, () => {
      setShowDropdown(false)
      setFilteredCmds([])
      setHighlightedIndex(-1)
      setPendingRememberContent(null)
    })
  }, [workspaceTabId])

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

  const handleFocus = useCallback(() => {
    if (workspaceTabId) {
      setLastFocusedSurface(workspaceTabId, 'ai-input')
    }
  }, [setLastFocusedSurface, workspaceTabId])

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

        // `/remember` is scope-aware. When the default scope is "Always ask"
        // we show an inline level picker instead of saving immediately.
        if (cmdName === 'remember') {
          const args = cmdArgs.trim()
          if (!args) {
            // Surface the standard empty-args error via executeRemember.
            executeRemember(cmdArgs, connectionId).catch(() => {
              /* error already toasted */
            })
            return
          }
          if (resolveRememberScope() === 'ask') {
            setPendingRememberContent(args)
            return
          }
        }

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

  const handleScopePick = useCallback(
    (scope: MemoryScope) => {
      const content = pendingRememberContent
      setPendingRememberContent(null)
      if (!content || !connectionId) {
        return
      }
      // executeRemember toasts success/failure itself.
      executeRemember(content, connectionId, scope)
        .then(() => {
          setValue('')
          resetHeight()
        })
        .catch((err: unknown) => {
          logFrontend(
            'warn',
            `[AiChatInput] /remember (ask) rejected: ${err instanceof Error ? err.message : String(err)}`
          )
        })
    },
    [pendingRememberContent, connectionId, resetHeight]
  )

  const handleScopeCancel = useCallback(() => {
    setPendingRememberContent(null)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
  }, [])

  const handleCancel = useCallback(() => {
    useAiStore.getState().cancelStream(tabId)
  }, [tabId])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      // While the "Always Ask" scope picker is open it owns Enter/Arrow/Escape
      // (handled at the document level inside MemoryScopePicker); swallow those
      // keys here so they neither send a message nor insert a newline.
      if (pendingRememberContent !== null) {
        if (
          e.key === 'Enter' ||
          e.key === 'Escape' ||
          e.key === 'ArrowUp' ||
          e.key === 'ArrowDown'
        ) {
          e.preventDefault()
        }
        return
      }
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
    [pendingRememberContent, showDropdown, filteredCmds, highlightedIndex, selectCommand, handleSend]
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
        {pendingRememberContent !== null && (
          <MemoryScopePicker
            hasGroup={hasGroup}
            defaultScope={defaultRememberScope}
            onSelect={handleScopePick}
            onCancel={handleScopeCancel}
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
              <XIcon size={12} />
            </IconButton>
          </div>
        )}
        <Textarea
          ref={textareaRef}
          variant="bare"
          className={styles.textarea}
          value={value}
          onChange={handleChange}
          onFocus={handleFocus}
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
          <StopIcon size={18} weight="fill" />
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
          <PaperPlaneRightIcon size={18} weight="fill" />
        </Button>
      )}
    </div>
  )
}
