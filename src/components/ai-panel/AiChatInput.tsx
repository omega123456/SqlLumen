import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type RefObject } from 'react'
import { PaperPlaneRightIcon, StopIcon, XIcon } from '@phosphor-icons/react'
import { useAiStore } from '../../stores/ai-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { useConnectionStore } from '../../stores/connection-store'
import { subscribeToTabDeactivated } from '../../lib/workspace-tab-activity-events'
import { Textarea } from '../common/Textarea'
import { Button } from '../common/Button'
import { joinClassNames, SCROLLBAR } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'
import { SlashCommandDropdown } from './SlashCommandDropdown'
import { MemoryScopePicker } from './MemoryScopePicker'
import type { SlashCommand } from '../../lib/slash-commands'
import { isMemoryScope } from '../../lib/ai-memory-commands'
import { isPlainEnterKey } from '../../lib/input-events'
import { useChatSend, useRememberScopePrompt } from './ai-chat-input/use-chat-send'
import { useSlashCommandDropdown } from './ai-chat-input/use-slash-command-dropdown'
import { useTextareaAutoHeight } from './ai-chat-input/use-textarea-auto-height'

const CONTEXT_CHIP_MAX_LENGTH = 60
const TRUNCATION_ELLIPSIS = '...'
const SCOPE_PICKER_OWNED_KEYS = new Set(['Enter', 'Escape', 'ArrowUp', 'ArrowDown'])
const SLASH_COMMAND_LISTBOX_ID = 'slash-command-listbox'

interface PlaceholderInputs {
  externalPlaceholder: string | undefined
  aiEnabled: boolean
  isConfigured: boolean
}

function resolvePlaceholder(inputs: PlaceholderInputs): string {
  if (inputs.externalPlaceholder) return inputs.externalPlaceholder
  if (!inputs.aiEnabled) return 'AI is disabled — enable it in settings'
  if (!inputs.isConfigured) return 'Configure AI endpoint and model in settings'
  return 'Ask about your SQL or schema'
}

function truncateContextSql(sql: string): string {
  if (sql.length <= CONTEXT_CHIP_MAX_LENGTH) return sql
  return sql.slice(0, CONTEXT_CHIP_MAX_LENGTH - TRUNCATION_ELLIPSIS.length) + TRUNCATION_ELLIPSIS
}

function slashCommandComboboxProps(
  showDropdown: boolean,
  highlightedCommand: SlashCommand | undefined
) {
  if (!showDropdown) return {}
  return {
    role: 'combobox',
    'aria-expanded': true,
    'aria-controls': SLASH_COMMAND_LISTBOX_ID,
    'aria-activedescendant': highlightedCommand
      ? `slash-cmd-${highlightedCommand.name}`
      : undefined,
  }
}

function useAiChatReadiness() {
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
  const isConfigured = hasEndpoint && hasModel
  return { aiEnabled: aiEnabled, isConfigured: isConfigured, isReady: aiEnabled && isConfigured }
}

interface AttachedContextChipProps {
  sql: string
  onRemove: () => void
}

function AttachedContextChip({ sql, onRemove }: AttachedContextChipProps) {
  return (
    <div
      className="inline-flex h-6.5 max-w-full items-center gap-1.5 self-start rounded-control border border-light-stroke-card bg-light-fill-control pr-0.5 pl-2 dark:border-dark-stroke-card dark:bg-dark-fill-control"
      data-testid="ai-context-chip"
    >
      <span
        className="min-w-0 truncate font-mono text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant"
        title={sql}
      >
        {truncateContextSql(sql)}
      </span>
      <Button
        variant="bare"
        className={joinClassNames([
          'inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-track bg-transparent p-0 text-light-on-surface-variant transition-color-and-bg duration-150 hover:bg-light-fill-subtle-hover hover:text-light-on-surface dark:text-dark-on-surface-variant dark:hover:bg-dark-fill-subtle-hover dark:hover:text-dark-on-surface',
          FOCUS_RING,
        ])}
        onClick={onRemove}
        title="Remove context"
        aria-label="Remove attached SQL context"
        data-testid="ai-context-chip-remove"
      >
        <XIcon size={12} />
      </Button>
    </div>
  )
}

interface SendOrStopButtonProps {
  isGenerating: boolean
  canSend: boolean
  onSend: () => void
  onStop: () => void
}

function SendOrStopButton({ isGenerating, canSend, onSend, onStop }: SendOrStopButtonProps) {
  if (isGenerating) {
    return (
      <Button
        variant="danger"
        iconOnly
        onClick={onStop}
        title="Stop generation"
        aria-label="Stop generation"
        data-testid="ai-stop-button"
      >
        <StopIcon size={16} weight="fill" />
      </Button>
    )
  }
  return (
    <Button
      variant="accent"
      iconOnly
      onClick={onSend}
      disabled={!canSend}
      title="Send message"
      aria-label="Send message"
      data-testid="ai-send-button"
    >
      <PaperPlaneRightIcon size={16} weight="regular" />
    </Button>
  )
}

export interface AiChatInputProps {
  tabId: string
  connectionId: string | null
  suggestionText?: string
  onSuggestionConsumed?: () => void
  disabled?: boolean
  placeholder?: string
  workspaceTabId?: string
}

interface SuggestionFill {
  suggestionText: string | undefined
  onSuggestionConsumed: (() => void) | undefined
}

function useChatDraft(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  suggestion: SuggestionFill
) {
  const { suggestionText, onSuggestionConsumed } = suggestion
  const [value, setValue] = useState('')
  const resetHeight = useTextareaAutoHeight(textareaRef, value)

  useEffect(() => {
    if (suggestionText) {
      const frame = requestAnimationFrame(() => {
        setValue(suggestionText)
        onSuggestionConsumed?.()
        textareaRef.current?.focus()
      })

      return () => cancelAnimationFrame(frame)
    }
  }, [suggestionText, onSuggestionConsumed, textareaRef])

  const clearInput = useCallback(() => {
    setValue('')
    resetHeight()
  }, [resetHeight])

  return { value, setValue, clearInput }
}

function useHasConnectionGroup(connectionId: string | null): boolean {
  return useConnectionStore(
    (state) =>
      (connectionId ? (state.activeConnections[connectionId]?.profile?.groupId ?? null) : null) !==
      null
  )
}

function useDefaultRememberScope() {
  return useSettingsStore((state) => {
    const value = state.pendingChanges['ai.rememberScope'] ?? state.settings['ai.rememberScope']
    return isMemoryScope(value) ? value : undefined
  })
}

function useFocusSurfaceTracking(workspaceTabId: string | undefined) {
  const setLastFocusedSurface = useWorkspaceStore((state) => state.setLastFocusedSurface)
  return useCallback(() => {
    if (workspaceTabId) {
      setLastFocusedSurface(workspaceTabId, 'ai-input')
    }
  }, [setLastFocusedSurface, workspaceTabId])
}

function useResetOnTabDeactivated(workspaceTabId: string | undefined, reset: () => void): void {
  useEffect(() => {
    if (!workspaceTabId) {
      return
    }

    return subscribeToTabDeactivated(workspaceTabId, reset)
  }, [workspaceTabId, reset])
}

function useAiChatInputController(
  props: AiChatInputProps,
  textareaRef: RefObject<HTMLTextAreaElement | null>
) {
  const { tabId, connectionId, workspaceTabId } = props
  const draft = useChatDraft(textareaRef, {
    suggestionText: props.suggestionText,
    onSuggestionConsumed: props.onSuggestionConsumed,
  })
  const dropdown = useSlashCommandDropdown({ textareaRef: textareaRef, setValue: draft.setValue })
  const scopePrompt = useRememberScopePrompt({
    connectionId: connectionId,
    clearInput: draft.clearInput,
    textareaRef: textareaRef,
  })
  const isGenerating = useAiStore((state) => state.tabs[tabId]?.isGenerating ?? false)
  const readiness = useAiChatReadiness()
  const isInputLocked = Boolean(props.disabled) || isGenerating
  const canSend = readiness.isReady && draft.value.trim().length > 0 && !isInputLocked
  const handleSend = useChatSend({
    tabId: tabId,
    connectionId: connectionId,
    canSend: canSend,
    draft: draft,
    askForRememberScope: scopePrompt.setPendingRememberContent,
  })

  const { resetDropdown } = dropdown
  const { setPendingRememberContent } = scopePrompt
  const resetTransientUi = useCallback(() => {
    resetDropdown()
    setPendingRememberContent(null)
  }, [resetDropdown, setPendingRememberContent])
  useResetOnTabDeactivated(workspaceTabId, resetTransientUi)

  return {
    draft,
    dropdown,
    scopePrompt,
    isGenerating,
    readiness,
    isInputLocked,
    canSend,
    handleSend,
  }
}

type AiChatInputController = ReturnType<typeof useAiChatInputController>

function useChatInputKeyDown({ scopePrompt, dropdown, handleSend }: AiChatInputController) {
  const { pendingRememberContent } = scopePrompt
  const { handleDropdownKey } = dropdown
  return useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (pendingRememberContent !== null) {
        if (SCOPE_PICKER_OWNED_KEYS.has(event.key)) event.preventDefault()
        return
      }
      if (handleDropdownKey(event)) return
      if (isPlainEnterKey(event)) {
        event.preventDefault()
        handleSend()
      }
    },
    [pendingRememberContent, handleDropdownKey, handleSend]
  )
}

interface ChatInputPopupsProps {
  tabId: string
  connectionId: string | null
  controller: AiChatInputController
}

function ChatInputPopups({ tabId, connectionId, controller }: ChatInputPopupsProps) {
  const { dropdown, scopePrompt } = controller
  const hasGroup = useHasConnectionGroup(connectionId)
  const defaultRememberScope = useDefaultRememberScope()
  const attachedContext = useAiStore((state) => state.tabs[tabId]?.attachedContext ?? null)
  return (
    <>
      {dropdown.showDropdown && (
        <SlashCommandDropdown
          commands={dropdown.filteredCommands}
          highlightedIndex={dropdown.highlightedIndex}
          onSelect={dropdown.selectCommand}
          onHighlightChange={dropdown.setHighlightedIndex}
        />
      )}
      {scopePrompt.pendingRememberContent !== null && (
        <MemoryScopePicker
          hasGroup={hasGroup}
          defaultScope={defaultRememberScope}
          onSelect={scopePrompt.handleScopePick}
          onCancel={scopePrompt.handleScopeCancel}
        />
      )}
      {attachedContext && (
        <AttachedContextChip
          sql={attachedContext.sql}
          onRemove={() => useAiStore.getState().clearAttachedContext(tabId)}
        />
      )}
    </>
  )
}

export function AiChatInput(props: AiChatInputProps) {
  const { tabId, connectionId, placeholder: externalPlaceholder, workspaceTabId } = props
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const controller = useAiChatInputController(props, textareaRef)
  const { draft, dropdown, readiness } = controller
  const handleKeyDown = useChatInputKeyDown(controller)
  const handleFocus = useFocusSurfaceTracking(workspaceTabId)
  const { setValue } = draft
  const { updateDropdown } = dropdown

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.target.value
      setValue(newValue)
      updateDropdown(newValue)
    },
    [setValue, updateDropdown]
  )

  return (
    <div
      className="flex shrink-0 flex-row items-end gap-1.5 border-t border-light-stroke-divider bg-light-surface-container p-2.5 dark:border-dark-stroke-divider dark:bg-dark-surface-container"
      data-testid="ai-chat-input"
    >
      <div className="relative flex min-w-0 flex-1 flex-col gap-2">
        <ChatInputPopups tabId={tabId} connectionId={connectionId} controller={controller} />
        <Textarea
          ref={textareaRef}
          variant="fixedSize"
          className={joinClassNames(['max-h-35 min-h-control overflow-y-auto', SCROLLBAR])}
          value={draft.value}
          onChange={handleChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          {...slashCommandComboboxProps(
            dropdown.showDropdown,
            dropdown.filteredCommands[dropdown.highlightedIndex]
          )}
          placeholder={resolvePlaceholder({
            externalPlaceholder: externalPlaceholder,
            aiEnabled: readiness.aiEnabled,
            isConfigured: readiness.isConfigured,
          })}
          disabled={controller.isInputLocked}
          rows={1}
          data-testid="ai-chat-textarea"
        />
      </div>

      <SendOrStopButton
        isGenerating={controller.isGenerating}
        canSend={controller.canSend}
        onSend={controller.handleSend}
        onStop={() => useAiStore.getState().cancelStream(tabId)}
      />
    </div>
  )
}
