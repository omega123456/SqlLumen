import { describe, expect, it } from 'vitest'
import { serializeCsv } from '../../lib/csv-utils'

describe('serializeCsv', () => {
  it('serializes headers and values using CSV-compatible escaping', () => {
    expect(
      serializeCsv(
        ['id', 'text', 'empty', 'enabled', 'details'],
        [
          [1, 'plain', null, true, { role: 'admin' }],
          [2, 'comma, quote " and\nnewline', undefined, false, ['a', 'b']],
        ]
      )
    ).toBe(
      'id,text,empty,enabled,details\r\n' +
        '1,plain,,1,"{""role"":""admin""}"\r\n' +
        '2,"comma, quote "" and\nnewline",,0,"[""a"",""b""]"\r\n'
    )
  })
})
