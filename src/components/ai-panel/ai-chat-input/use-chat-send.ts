import { useCallback, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { useAiStore } from '../../../stores/ai-store'
import {
  executeRemember,
  isEmptyRememberInvocation,
  parseSlashInvocation,
  shouldAskForRememberScope,
  type SlashInvocation,
} from '../../../lib/slash-commands'
import { showErrorToast } from '../../../stores/toast-store'
import type { MemoryScope } from '../../../lib/ai-memory-commands'
import { logFrontend } from '../../../lib/app-log-commands'
import { toErrorMessage } from '../../../lib/error-message'

function logRejectedSlashCommand(invocation: SlashInvocation, error: unknown): void {
  const commandName = invocation.command.name
  logFrontend(
    'warn',
    `[AiChatInput] slash command /${commandName} rejected: ${toErrorMessage(error)}`
  )
}

export interface ChatDraft {
  value: string
  setValue: Dispatch<SetStateAction<string>>
  clearInput: () => void
}

export interface RememberScopePromptOptions {
  connectionId: string | null
  clearInput: () => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

export function useRememberScopePrompt({
  connectionId,
  clearInput,
  textareaRef,
}: RememberScopePromptOptions) {
  const [pendingRememberContent, setPendingRememberContent] = useState<string | null>(null)

  const handleScopePick = useCallback(
    (scope: MemoryScope) => {
      const content = pendingRememberContent
      setPendingRememberContent(null)
      if (!content) return
      if (!connectionId) return
      executeRemember(content, connectionId, scope)
        .then(clearInput)
        .catch((error: unknown) => {
          logFrontend('warn', `[AiChatInput] /remember (ask) rejected: ${toErrorMessage(error)}`)
        })
    },
    [pendingRememberContent, connectionId, clearInput]
  )

  const handleScopeCancel = useCallback(() => {
    setPendingRememberContent(null)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
  }, [textareaRef])

  return { pendingRememberContent, setPendingRememberContent, handleScopePick, handleScopeCancel }
}

export interface SlashInvocationRunnerOptions {
  connectionId: string | null
  draft: ChatDraft
  askForRememberScope: (content: string) => void
}

function useSlashInvocationRunner({
  connectionId,
  draft,
  askForRememberScope,
}: SlashInvocationRunnerOptions) {
  const { value, setValue, clearInput } = draft
  return useCallback(
    (invocation: SlashInvocation) => {
      if (!connectionId) {
        showErrorToast('No active connection')
        return
      }
      if (isEmptyRememberInvocation(invocation)) {
        executeRemember(invocation.commandArgs, connectionId).catch((error: unknown) =>
          logRejectedSlashCommand(invocation, error)
        )
        return
      }
      if (shouldAskForRememberScope(invocation)) {
        askForRememberScope(invocation.commandArgs.trim())
        return
      }
      const submittedValue = value
      invocation.command
        .execute(invocation.commandArgs, connectionId)
        .then(clearInput)
        .catch((error: unknown) => {
          setValue(submittedValue)
          logRejectedSlashCommand(invocation, error)
        })
    },
    [value, connectionId, clearInput, setValue, askForRememberScope]
  )
}

export interface ChatSendOptions extends SlashInvocationRunnerOptions {
  tabId: string
  canSend: boolean
}

export function useChatSend(options: ChatSendOptions) {
  const { tabId, connectionId, canSend, draft } = options
  const { value, clearInput } = draft
  const runSlashInvocation = useSlashInvocationRunner(options)

  return useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed) return
    if (!canSend) return

    const slashInvocation = parseSlashInvocation(trimmed)
    if (slashInvocation) {
      runSlashInvocation(slashInvocation)
      return
    }
    if (!connectionId) return

    useAiStore.getState().sendMessage(tabId, {
      connectionId: connectionId,
      message: trimmed,
      settings: {},
    })
    clearInput()
  }, [value, connectionId, canSend, tabId, clearInput, runSlashInvocation])
}
