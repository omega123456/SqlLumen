import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipc } from '../ipc-mock'
import {
  createFavorite,
  listFavorites,
  updateFavorite,
  deleteFavorite,
} from '../../lib/favorites-commands'

beforeEach(() => {
  vi.clearAllMocks()
  ipc.override('create_favorite', () => 1)
  ipc.override('list_favorites', () => [])
  ipc.override('update_favorite', () => true)
  ipc.override('delete_favorite', () => true)
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

    const result = await createFavorite(input)
    expect(result).toBe(1)

    const calls = ipc.calls('create_favorite')
    expect(calls).toHaveLength(1)
    const capturedArgs = calls[0] as Record<string, unknown>
    expect(capturedArgs.input).toEqual(input)
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

    ipc.override('list_favorites', () => mockResponse)

    const result = await listFavorites('conn-1')
    expect(result).toEqual(mockResponse)

    const calls = ipc.calls('list_favorites')
    expect(calls).toHaveLength(1)
    const capturedArgs = calls[0] as Record<string, unknown>
    expect(capturedArgs.connectionId).toBe('conn-1')
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

    const result = await updateFavorite(1, input)
    expect(result).toBe(true)

    const calls = ipc.calls('update_favorite')
    expect(calls).toHaveLength(1)
    const capturedArgs = calls[0] as Record<string, unknown>
    expect(capturedArgs.id).toBe(1)
    expect(capturedArgs.input).toEqual(input)
  })
})

describe('deleteFavorite', () => {
  it('calls invoke with correct id', async () => {
    const result = await deleteFavorite(1)
    expect(result).toBe(true)

    const calls = ipc.calls('delete_favorite')
    expect(calls).toHaveLength(1)
    const capturedArgs = calls[0] as Record<string, unknown>
    expect(capturedArgs.id).toBe(1)
  })
})
