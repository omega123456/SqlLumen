import { describe, expect, it } from 'vitest'
import { getExportLogsFixture, getLogsPageFixture } from '../playwright-fixtures'

describe('playwright log fixtures', () => {
  it('keeps the requested page number even when the page is empty', () => {
    const page = getLogsPageFixture(4, 'all')

    expect(page.page).toBe(4)
    expect(page.entries).toHaveLength(0)
    expect(page.total).toBe(120)
  })

  it('counts export rows from explicit timestamp boundaries', () => {
    const exported = getExportLogsFixture('2026-06-06T13:40:00.000Z', '2026-06-06T14:32:07.000Z')

    expect(exported).toBe(53)
  })
})
