import { describe, expect, it } from 'vitest'
import { buildGlideColumns } from '../../../../components/shared/glide/glide-column-adapter'

describe('buildGlideColumns', () => {
  it('derives ids, titles and widths for keyed, unkeyed and unsized columns', () => {
    const columns = buildGlideColumns(
      [
        { key: '', name: <span>Name</span>, width: '180px' },
        { key: 'age', name: 'Age', width: Number.NaN },
      ],
      { hasRowMarker: true }
    )
    expect(columns[0]).toMatchObject({ id: '0', title: '', width: 180 })
    expect(columns[1]).toMatchObject({ id: 'age', title: 'Age', width: 150 })
  })
})
