import { describe, it, expect } from 'vitest'
import {
  computeFilterMatchIds,
  computeScopedFilterMatchIds,
  hasMatchingDescendantInFilter,
  isNodeUnderFilterScope,
} from '../../lib/tree-filter'
import { makeNodeId } from '../../stores/schema-store'
import type { TreeNode } from '../../types/schema'

function n(partial: TreeNode): TreeNode {
  return partial
}

describe('tree-filter', () => {
  describe('isNodeUnderFilterScope', () => {
    it('returns true for the scope root itself', () => {
      const dbId = makeNodeId('database', 'a', 'a')
      const nodes: Record<string, TreeNode> = {
        [dbId]: n({
          id: dbId,
          label: 'a',
          type: 'database',
          parentId: null,
          hasChildren: false,
          isLoaded: true,
        }),
      }
      expect(isNodeUnderFilterScope(dbId, dbId, nodes)).toBe(true)
    })
  })

  describe('computeScopedFilterMatchIds', () => {
    it('matches globally when scopeRootId is null', () => {
      const dbA = makeNodeId('database', 'a', 'a')
      const dbB = makeNodeId('database', 'b', 'b')
      const nodes: Record<string, TreeNode> = {
        [dbA]: n({
          id: dbA,
          label: 'findme',
          type: 'database',
          parentId: null,
          hasChildren: false,
          isLoaded: true,
        }),
        [dbB]: n({
          id: dbB,
          label: 'other',
          type: 'database',
          parentId: null,
          hasChildren: false,
          isLoaded: true,
        }),
      }
      const ids = computeScopedFilterMatchIds(nodes, 'find', null)
      expect(ids.has(dbA)).toBe(true)
      expect(ids.has(dbB)).toBe(false)
    })

    it('falls back to global when scope root is missing from nodes', () => {
      const dbA = makeNodeId('database', 'a', 'a')
      const nodes: Record<string, TreeNode> = {
        [dbA]: n({
          id: dbA,
          label: 'findme',
          type: 'database',
          parentId: null,
          hasChildren: false,
          isLoaded: true,
        }),
      }
      const ids = computeScopedFilterMatchIds(nodes, 'find', 'nonexistent-id')
      expect(ids.has(dbA)).toBe(true)
    })
  })

  describe('hasMatchingDescendantInFilter', () => {
    it('returns false when only the node itself is in the set', () => {
      const dbId = makeNodeId('database', 'a', 'a')
      const catId = makeNodeId('category', 'a', 'table')
      const nodes: Record<string, TreeNode> = {
        [dbId]: n({
          id: dbId,
          label: 'a',
          type: 'database',
          parentId: null,
          hasChildren: true,
          isLoaded: true,
        }),
        [catId]: n({
          id: catId,
          label: 'Tables',
          type: 'category',
          parentId: dbId,
          hasChildren: false,
          isLoaded: true,
        }),
      }
      const set = new Set<string>([catId])
      expect(hasMatchingDescendantInFilter(catId, set, nodes)).toBe(false)
    })
  })

  describe('computeFilterMatchIds', () => {
    it('includes ancestors above scope for global use', () => {
      const dbId = makeNodeId('database', 'a', 'a')
      const catId = makeNodeId('category', 'a', 'table')
      const tableId = makeNodeId('table', 'a', 't')
      const nodes: Record<string, TreeNode> = {
        [dbId]: n({
          id: dbId,
          label: 'a',
          type: 'database',
          parentId: null,
          hasChildren: true,
          isLoaded: true,
        }),
        [catId]: n({
          id: catId,
          label: 'Tables',
          type: 'category',
          parentId: dbId,
          hasChildren: true,
          isLoaded: true,
        }),
        [tableId]: n({
          id: tableId,
          label: 't',
          type: 'table',
          parentId: catId,
          hasChildren: false,
          isLoaded: true,
        }),
      }
      const ids = computeFilterMatchIds(nodes, 't')
      expect(ids.has(tableId)).toBe(true)
      expect(ids.has(catId)).toBe(true)
      expect(ids.has(dbId)).toBe(true)
    })
  })
})
