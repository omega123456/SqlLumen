import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
const BODY_OPENING_TAG = /<body\b[^>]*>/s
const SELECT_TEXT_CLASS = /["' ]select-text[" ']/
const SCHEMA_INFO_DIRECTORY = 'src/components/schema-info'
const SCHEMA_INFO_SELECTABLE_SOURCES = ['SchemaTableParts.tsx', 'MetadataCard.tsx', 'StatsRow.tsx']

describe('user-select policy', () => {
  it('should set select-none on the body element to prevent text selection globally', () => {
    const bodyTag = BODY_OPENING_TAG.exec(indexHtml)?.[0] ?? ''

    expect(bodyTag.split(/\s+/)).toContain('select-none')
  })

  it.each(SCHEMA_INFO_SELECTABLE_SOURCES)(
    'should re-enable text selection through select-text in %s',
    (sourceFile) => {
      const source = readFileSync(resolve(process.cwd(), SCHEMA_INFO_DIRECTORY, sourceFile), 'utf8')

      expect(source).toMatch(SELECT_TEXT_CLASS)
    }
  )
})
