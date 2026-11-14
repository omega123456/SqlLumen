import { hasWindow } from '../tauri-env'
import { getStaticFixture } from '../../tests/playwright-fixtures'
import { returnNull } from './mock-handler-types'
import type { PlaywrightIpcArgs, PluginIpcHandler } from './mock-handler-types'
import { getMockUpdateMetadata, readMockWindowFlag } from './mock-session-state'

const AI_STREAM_START_DELAY_MS = 10

const AI_STREAM_CHUNK_INTERVAL_MS = 10

const AI_THINKING_LEAD_MS = 20

const AI_STREAM_ERROR_DELAY_MS = 20

const AI_STREAM_CHUNK_PATTERN = /[\s\S]{1,20}/g

const eventListenerCallbackIds = new Map<string, number[]>()

function emitMockEvent(eventName: string, payload: unknown): void {
  if (!hasWindow()) return
  const runCallback = window.__TAURI_INTERNALS__?.runCallback
  if (!runCallback) return

  const ids = eventListenerCallbackIds.get(eventName) ?? []
  for (const id of ids) {
    runCallback(id, { event: eventName, payload: payload })
  }
}

function splitAiResponseIntoChunks(responseText: string): string[] {
  return responseText.match(AI_STREAM_CHUNK_PATTERN) ?? [responseText]
}

function scheduleAiContentStream(streamId: string, startDelayMs: number): void {
  let delay = startDelayMs
  for (const chunk of splitAiResponseIntoChunks(getStaticFixture('aiChat').responseText)) {
    setTimeout(() => {
      emitMockEvent('ai-stream-chunk', { streamId: streamId, content: chunk, kind: 'content' })
    }, delay)
    delay += AI_STREAM_CHUNK_INTERVAL_MS
  }
  setTimeout(() => {
    emitMockEvent('ai-stream-done', { streamId })
  }, delay)
}

function scheduleAiThinkingStream(streamId: string): void {
  const thinkingText = getStaticFixture('aiChat').thinkingText
  setTimeout(() => {
    emitMockEvent('ai-stream-chunk', {
      streamId: streamId,
      content: thinkingText,
      kind: 'thinking',
    })
  }, AI_STREAM_START_DELAY_MS)
  scheduleAiContentStream(streamId, AI_STREAM_START_DELAY_MS + AI_THINKING_LEAD_MS)
}

function scheduleAiStreamError(streamId: string): void {
  const errorMessage = getStaticFixture('aiChat').errorMessage
  setTimeout(() => {
    emitMockEvent('ai-stream-error', { streamId: streamId, error: errorMessage })
  }, AI_STREAM_ERROR_DELAY_MS)
}

interface UpdaterEventChannel {
  onmessage: (payload: unknown) => void
}

function isUpdaterEventChannel(candidate: unknown): candidate is UpdaterEventChannel {
  if (typeof candidate !== 'object') return false
  if (candidate === null) return false
  return 'onmessage' in candidate && typeof candidate.onmessage === 'function'
}

function emitUpdaterEvent(args: PlaywrightIpcArgs, payload: unknown): void {
  const onEvent = args?.onEvent
  if (isUpdaterEventChannel(onEvent)) onEvent.onmessage(payload)
}

function emitUpdaterDownload(args: PlaywrightIpcArgs, chunkLengths: number[]): void {
  emitUpdaterEvent(args, {
    event: 'Started',
    data: { contentLength: getStaticFixture('update').contentLength },
  })
  for (const chunkLength of chunkLengths) {
    emitUpdaterEvent(args, { event: 'Progress', data: { chunkLength: chunkLength } })
  }
  emitUpdaterEvent(args, { event: 'Finished' })
}

interface MockEventSubscription {
  eventName: string
  callbackId: number
}

function readMockEventSubscription(
  eventName: unknown,
  callbackId: unknown
): MockEventSubscription | null {
  if (typeof eventName !== 'string') return null
  if (eventName === '') return null
  if (typeof callbackId !== 'number') return null
  return { eventName, callbackId }
}

function listenToMockEvent(args: PlaywrightIpcArgs): unknown {
  const subscription = readMockEventSubscription(args?.event, args?.handler)
  if (!subscription) {
    return args?.handler ?? null
  }
  const ids = eventListenerCallbackIds.get(subscription.eventName) ?? []
  ids.push(subscription.callbackId)
  eventListenerCallbackIds.set(subscription.eventName, ids)
  return subscription.callbackId
}

function unlistenFromMockEvent(args: PlaywrightIpcArgs): null {
  const subscription = readMockEventSubscription(args?.event, args?.eventId)
  if (!subscription) {
    return null
  }
  const ids = eventListenerCallbackIds.get(subscription.eventName) ?? []
  const index = ids.indexOf(subscription.callbackId)
  if (index !== -1) ids.splice(index, 1)
  return null
}

export const TAURI_PLUGIN_HANDLERS: Record<string, PluginIpcHandler> = {
  'plugin:event|listen': listenToMockEvent,
  'plugin:event|unlisten': unlistenFromMockEvent,
  'plugin:updater|check': () => getMockUpdateMetadata(),
  'plugin:updater|download_and_install': (args) => {
    emitUpdaterDownload(args, getStaticFixture('update').installChunkLengths)
    return null
  },
  'plugin:updater|download': (args) => {
    emitUpdaterDownload(args, getStaticFixture('update').downloadChunkLengths)
    return getStaticFixture('update').downloadRid
  },
  'plugin:updater|install': returnNull,
  'plugin:os|platform': () => getStaticFixture('platform'),
  'plugin:process|restart': returnNull,
  'plugin:process|relaunch': returnNull,
}

export function startMockAiChat({ request }: { request: { streamId: string } }): null {
  const streamId = request.streamId ?? getStaticFixture('aiChat').fallbackStreamId
  if (readMockWindowFlag('__mockAiError__')) {
    scheduleAiStreamError(streamId)
    return null
  }
  if (readMockWindowFlag('__mockAiThinking__')) {
    scheduleAiThinkingStream(streamId)
    return null
  }
  scheduleAiContentStream(streamId, AI_STREAM_START_DELAY_MS)
  return null
}
