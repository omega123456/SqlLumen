import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockIPC } from '@tauri-apps/api/mocks'
import {
  createFavorite,
  listFavorites,
  updateFavorite,
  deleteFavorite,
} from '../../lib/favorites-commands'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createFavorite', () => {
  it('calls invoke with correct input', async () => {
    const input = {
      connectionId: 'conn-1',
      name: 'My Query',
      sqlText: 'SELECT 1',
      description: 'test description',
      category: 'test',
    }

    mockIPC((cmd, args) => {
      if (cmd === 'create_favorite') {
        expect((args as Record<string, unknown>).input).toEqual(input)
        return 1
      }
      return null
    })

    const result = await createFavorite(input)
    expect(result).toBe(1)
  })
})

describe('listFavorites', () => {
  it('calls invoke with correct connectionId', async () => {
    const mockResponse = [
      {
        id: 1,
        name: 'Test',
        sqlText: 'SELECT 1',
        description: null,
        category: null,
        connectionId: 'conn-1',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      },
    ]

    mockIPC((cmd, args) => {
      if (cmd === 'list_favorites') {
        expect((args as Record<string, unknown>).connectionId).toBe('conn-1')
        return mockResponse
      }
      return null
    })

    const result = await listFavorites('conn-1')
    expect(result).toEqual(mockResponse)
  })
})

describe('updateFavorite', () => {
  it('calls invoke with correct id and input', async () => {
    const input = {
      name: 'Updated',
      sqlText: 'SELECT 2',
      description: null,
      category: null,
    }

    mockIPC((cmd, args) => {
      if (cmd === 'update_favorite') {
        expect((args as Record<string, unknown>).id).toBe(1)
        expect((args as Record<string, unknown>).input).toEqual(input)
        return true
      }
      return null
    })

    const result = await updateFavorite(1, input)
    expect(result).toBe(true)
  })
})

describe('deleteFavorite', () => {
  it('calls invoke with correct id', async () => {
    mockIPC((cmd, args) => {
      if (cmd === 'delete_favorite') {
        expect((args as Record<string, unknown>).id).toBe(1)
        return true
      }
      return null
    })

    const result = await deleteFavorite(1)
    expect(result).toBe(true)
  })
})
