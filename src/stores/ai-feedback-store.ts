import { create } from 'zustand'
import {
  dropExpiredEntries,
  recordAcceptedTables,
  weightedAcceptedTables,
  type AcceptedEntry,
  type AcceptedTable,
  type WeightedAcceptedTable,
} from './ai-feedback-store/accepted-entries'

interface AiFeedbackState {
  entries: AcceptedEntry[]
  recordAccepted: (connectionId: string, tables: AcceptedTable[]) => void
  getAcceptedTables: (connectionId: string) => WeightedAcceptedTable[]
  cleanup: () => void
}

export const useAiFeedbackStore = create<AiFeedbackState>()((set, get) => ({
  entries: [],

  recordAccepted: (connectionId, tables) => {
    const record = { connectionId: connectionId, tables: tables, seenAt: Date.now() }
    set((state) => recordAcceptedTables(state, record))
  },

  getAcceptedTables: (connectionId) =>
    weightedAcceptedTables(get().entries, { connectionId: connectionId, now: Date.now() }),

  cleanup: () => {
    const now = Date.now()
    set((state) => dropExpiredEntries(state, now))
  },
}))
