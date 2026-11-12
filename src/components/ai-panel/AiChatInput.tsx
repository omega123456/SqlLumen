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
import { toErrorMessage } from '../../lib/error-message'

const CONTEXT_CHIP_MAX_LENGTH = 60
const TRUNCATION_ELLIPSIS = '...'
/** One line of the 32px Fluent field (prototype `.ai-row .fld`). */
const MIN_TEXTAREA_HEIGHT_PX = 32
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
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([])
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  // When set, the "Always ask" memory scope picker is shown above the input.
  // The string is the (trimmed) memory content awaiting a scope choice.
  const [pendingRememberContent, setPendingRememberContent] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const setLastFocusedSurface = useWorkspaceStore((state) => state.setLastFocusedSurface)

  // The active connection's group presence (the session id `connectionId` maps
  // to a saved profile via the connection store). Used to enable/disable the
  // Group option in the scope picker.
  const hasGroup = useConnectionStore(
    (state) =>
      (connectionId ? (state.activeConnections[connectionId]?.profile?.groupId ?? null) : null) !==
      null
  )
  const isGenerating = useAiStore((state) => state.tabs[tabId]?.isGenerating ?? false)
  const attachedContext = useAiStore((state) => state.tabs[tabId]?.attachedContext ?? null)

  const aiEnabled = useSettingsStore(
    (state) =>
      (state.pendingChanges['ai.enabled'] ?? state.settings['ai.enabled'] ?? 'false') === 'true'
  )
  const hasEndpoint = useSettingsStore(
    (state) => !!(state.pendingChanges['ai.endpoint'] ?? state.settings['ai.endpoint'] ?? '')
  )
  const hasModel = useSettingsStore(
    (state) => !!(state.pendingChanges['ai.model'] ?? state.settings['ai.model'] ?? '')
  )
  // Saved default `/remember` scope, used to seed the scope-picker highlight.
  // Only a concrete level is passed through; `'ask'` (or anything else) lets
  // the picker fall back to Connection.
  const defaultRememberScope = useSettingsStore((state) => {
    const value = state.pendingChanges['ai.rememberScope'] ?? state.settings['ai.rememberScope']
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
    const element = textareaRef.current
    if (!element) {
      return
    }
    if (value.length === 0) {
      element.style.height = `${MIN_TEXTAREA_HEIGHT_PX}px`
      return
    }
    element.style.height = 'auto'
    // The field is border-box, so add its borders to the content-and-padding scroll height
    const borders = element.offsetHeight - element.clientHeight
    element.style.height = `${Math.min(
      Math.max(element.scrollHeight + borders, MIN_TEXTAREA_HEIGHT_PX),
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
      setFilteredCommands([])
      setHighlightedIndex(-1)
      setPendingRememberContent(null)
    })
  }, [workspaceTabId])

  const updateDropdown = useCallback((text: string) => {
    if (text.startsWith('/') && !text.includes(' ')) {
      const prefix = text.slice(1)
      const commands = filterCommands(prefix)
      setFilteredCommands(commands)
      setShowDropdown(commands.length > 0)
      setHighlightedIndex(-1)
    } else {
      setShowDropdown(false)
      setFilteredCommands([])
      setHighlightedIndex(-1)
    }
  }, [])

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value
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

  const selectCommand = useCallback((command: SlashCommand) => {
    const newValue = `/${command.name} `
    setValue(newValue)
    setShowDropdown(false)
    setFilteredCommands([])
    setHighlightedIndex(-1)
    requestAnimationFrame(() => {
      const element = textareaRef.current
      if (element) {
        element.focus()
        element.setSelectionRange(newValue.length, newValue.length)
      }
    })
  }, [])

  const resetHeight = useCallback(() => {
    requestAnimationFrame(() => {
      const element = textareaRef.current
      if (element) {
        element.style.height = `${MIN_TEXTAREA_HEIGHT_PX}px`
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
      const [, commandName, commandArgs] = slashMatch
      const command = findCommand(commandName)
      if (command) {
        if (!connectionId) {
          showErrorToast('No active connection')
          return
        }
        const savedValue = value

        // `/remember` is scope-aware. When the default scope is "Always ask"
        // we show an inline level picker instead of saving immediately.
        if (commandName === 'remember') {
          const args = commandArgs.trim()
          if (!args) {
            // Surface the standard empty-args error via executeRemember.
            executeRemember(commandArgs, connectionId).catch(() => {
              /* error already toasted */
            })
            return
          }
          if (resolveRememberScope() === 'ask') {
            setPendingRememberContent(args)
            return
          }
        }

        command
          .execute(commandArgs, connectionId)
          .then(() => {
            setValue('')
            resetHeight()
          })
          .catch((error: unknown) => {
            // Restore input on failure
            setValue(savedValue)
            logFrontend(
              'warn',
              `[AiChatInput] slash command /${commandName} rejected: ${toErrorMessage(error)}`
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
        .catch((error: unknown) => {
          logFrontend('warn', `[AiChatInput] /remember (ask) rejected: ${toErrorMessage(error)}`)
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
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // While the "Always ask" scope picker is open it owns Enter/Arrow/Escape
      // (handled at the document level inside MemoryScopePicker); swallow those
      // keys here so they neither send a message nor insert a newline.
      if (pendingRememberContent !== null) {
        if (
          event.key === 'Enter' ||
          event.key === 'Escape' ||
          event.key === 'ArrowUp' ||
          event.key === 'ArrowDown'
        ) {
          event.preventDefault()
        }
        return
      }
      if (showDropdown) {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setHighlightedIndex((previous) =>
            previous < filteredCommands.length - 1 ? previous + 1 : 0
          )
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setHighlightedIndex((previous) =>
            previous > 0 ? previous - 1 : filteredCommands.length - 1
          )
          return
        }
        if (event.key === 'Enter' && !event.shiftKey && highlightedIndex >= 0) {
          event.preventDefault()
          selectCommand(filteredCommands[highlightedIndex])
          return
        }
        if (event.key === 'Tab' && highlightedIndex >= 0) {
          event.preventDefault()
          selectCommand(filteredCommands[highlightedIndex])
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          setShowDropdown(false)
          return
        }
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        handleSend()
      }
    },
    [
      pendingRememberContent,
      showDropdown,
      filteredCommands,
      highlightedIndex,
      selectCommand,
      handleSend,
    ]
  )

  const handleRemoveContext = useCallback(() => {
    useAiStore.getState().clearAttachedContext(tabId)
  }, [tabId])

  return (
    <div className={styles.container} data-testid="ai-chat-input">
      <div className={styles.textareaWrapper}>
        {showDropdown && (
          <SlashCommandDropdown
            commands={filteredCommands}
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
              {attachedContext.sql.length > CONTEXT_CHIP_MAX_LENGTH
                ? attachedContext.sql.slice(
                    0,
                    CONTEXT_CHIP_MAX_LENGTH - TRUNCATION_ELLIPSIS.length
                  ) + TRUNCATION_ELLIPSIS
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
              ? `slash-cmd-${filteredCommands[highlightedIndex]?.name}`
              : undefined
          }
          placeholder={
            externalPlaceholder
              ? externalPlaceholder
              : !aiEnabled
                ? 'AI is disabled — enable it in settings'
                : !hasEndpoint || !hasModel
                  ? 'Configure AI endpoint and model in settings'
                  : 'Ask about your SQL or schema'
          }
          disabled={externalDisabled || isGenerating}
          rows={1}
          data-testid="ai-chat-textarea"
        />
      </div>

      {isGenerating ? (
        <Button
          variant="danger"
          iconOnly
          onClick={handleCancel}
          title="Stop generation"
          aria-label="Stop generation"
          data-testid="ai-stop-button"
        >
          <StopIcon size={16} weight="fill" />
        </Button>
      ) : (
        <Button
          variant="accent"
          iconOnly
          onClick={handleSend}
          disabled={!canSend}
          title="Send message"
          aria-label="Send message"
          data-testid="ai-send-button"
        >
          <PaperPlaneRightIcon size={16} weight="regular" />
        </Button>
      )}
    </div>
  )
}
