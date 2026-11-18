import { describe, it, expect } from 'vitest'
import { isCopiedIntoClone } from '../../lib/new-row-values'
import { makeTableColumnMeta } from '../helpers/column-meta-fixtures'

describe('isCopiedIntoClone', () => {
  it('leaves binary key and generated columns blank while copying binary non-key columns', () => {
    const keyColumns = ['uuid']
    const binaryKeyColumn = makeTableColumnMeta({ name: 'uuid', isBinary: true })
    const generatedColumn = makeTableColumnMeta({ name: 'total', isGenerated: true })
    const binaryValueColumn = makeTableColumnMeta({ name: 'avatar', isBinary: true })

    expect(isCopiedIntoClone(binaryKeyColumn, keyColumns)).toBe(false)
    expect(isCopiedIntoClone(generatedColumn, keyColumns)).toBe(false)
    expect(isCopiedIntoClone(binaryValueColumn, keyColumns)).toBe(true)
  })
})
