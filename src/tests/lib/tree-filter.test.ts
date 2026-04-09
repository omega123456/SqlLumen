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

    it('returns true for descendants of the scope root', () => {
      const dbId = makeNodeId('database', 'a', 'a')
      const catId = makeNodeId('category', 'a', 'table')
      const tableId = makeNodeId('table', 'a', 't1')
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
          label: 't1',
          type: 'table',
          parentId: catId,
          hasChildren: false,
          isLoaded: true,
        }),
      }
      expect(isNodeUnderFilterScope(tableId, catId, nodes)).toBe(true)
      expect(isNodeUnderFilterScope(catId, catId, nodes)).toBe(true)
    })

    it('returns false for ancestors and siblings outside the subtree', () => {
      const dbId = makeNodeId('database', 'a', 'a')
      const catId = makeNodeId('category', 'a', 'table')
      const otherDb = makeNodeId('database', 'b', 'b')
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
        [otherDb]: n({
          id: otherDb,
          label: 'b',
          type: 'database',
          parentId: null,
          hasChildren: false,
          isLoaded: true,
        }),
      }
      expect(isNodeUnderFilterScope(dbId, catId, nodes)).toBe(false)
      expect(isNodeUnderFilterScope(otherDb, catId, nodes)).toBe(false)
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

    it('includes only ancestors up to scope root for in-scope matches', () => {
      const dbId = makeNodeId('database', 'a', 'a')
      const catId = makeNodeId('category', 'a', 'table')
      const tableId = makeNodeId('table', 'a', 'users')
      const otherDb = makeNodeId('database', 'b', 'b')
      const nodes: Record<string, TreeNode> = {
        [dbId]: n({
          id: dbId,
          label: 'mydb',
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
          label: 'users',
          type: 'table',
          parentId: catId,
          hasChildren: false,
          isLoaded: true,
        }),
        [otherDb]: n({
          id: otherDb,
          label: 'users_clone',
          type: 'database',
          parentId: null,
          hasChildren: false,
          isLoaded: true,
        }),
      }
      const ids = computeScopedFilterMatchIds(nodes, 'users', dbId)
      expect(ids.has(tableId)).toBe(true)
      expect(ids.has(catId)).toBe(true)
      expect(ids.has(dbId)).toBe(true)
      expect(ids.has(otherDb)).toBe(false)
    })

    it('matches scope root label within subtree', () => {
      const dbId = makeNodeId('database', 'ecommerce', 'ecommerce')
      const nodes: Record<string, TreeNode> = {
        [dbId]: n({
          id: dbId,
          label: 'ecommerce',
          type: 'database',
          parentId: null,
          hasChildren: false,
          isLoaded: true,
        }),
      }
      const ids = computeScopedFilterMatchIds(nodes, 'commerce', dbId)
      expect(ids.has(dbId)).toBe(true)
    })

    it('always includes scope root when nothing else in scope matches', () => {
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
      const ids = computeScopedFilterMatchIds(nodes, 'nomatch', catId)
      expect(ids.size).toBe(1)
      expect(ids.has(catId)).toBe(true)
    })

    it('ignores column labels when matching within scope', () => {
      const dbId = makeNodeId('database', 'a', 'a')
      const catId = makeNodeId('category', 'a', 'table')
      const tableId = makeNodeId('table', 'a', 'users')
      const columnId = makeNodeId('column', 'a', 'users.id')
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
          label: 'users',
          type: 'table',
          parentId: catId,
          hasChildren: true,
          isLoaded: true,
        }),
        [columnId]: n({
          id: columnId,
          label: 'id',
          type: 'column',
          parentId: tableId,
          hasChildren: false,
          isLoaded: true,
        }),
      }

      const ids = computeScopedFilterMatchIds(nodes, 'id', catId)

      expect(ids.size).toBe(1)
      expect(ids.has(catId)).toBe(true)
      expect(ids.has(tableId)).toBe(false)
      expect(ids.has(columnId)).toBe(false)
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

    it('returns true when a strict descendant is in the set', () => {
      const dbId = makeNodeId('database', 'a', 'a')
      const catId = makeNodeId('category', 'a', 'table')
      const tableId = makeNodeId('table', 'a', 't1')
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
          label: 't1',
          type: 'table',
          parentId: catId,
          hasChildren: false,
          isLoaded: true,
        }),
      }
      const set = new Set<string>([catId, tableId])
      expect(hasMatchingDescendantInFilter(catId, set, nodes)).toBe(true)
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

    it('ignores column labels for global filtering', () => {
      const dbId = makeNodeId('database', 'a', 'a')
      const catId = makeNodeId('category', 'a', 'table')
      const tableId = makeNodeId('table', 'a', 'users')
      const columnId = makeNodeId('column', 'a', 'users.id')
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
          label: 'users',
          type: 'table',
          parentId: catId,
          hasChildren: true,
          isLoaded: true,
        }),
        [columnId]: n({
          id: columnId,
          label: 'id',
          type: 'column',
          parentId: tableId,
          hasChildren: false,
          isLoaded: true,
        }),
      }

      const ids = computeFilterMatchIds(nodes, 'id')

      expect(ids.size).toBe(0)
    })
  })
})
