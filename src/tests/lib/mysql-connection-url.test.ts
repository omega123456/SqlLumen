import { describe, expect, it } from 'vitest'
import {
  MISSING_HOST_REASON,
  MYSQL_X_REJECTED_REASON,
  OTHER_SCHEME_REJECTED_REASON,
  UNREADABLE_URL_REASON,
  formatConnectionUrl,
  parseConnectionComposerText,
  type ComposerText,
} from '../../lib/mysql-connection-url'

describe('parseConnectionComposerText', () => {
  it.each<[string, ComposerText]>([
    ['  orders ', { kind: 'search', query: 'orders' }],
    [
      'mysql://deploy:s3cret@shop-db.acme.io:3307/shop',
      {
        kind: 'url',
        fields: {
          host: 'shop-db.acme.io',
          port: 3307,
          username: 'deploy',
          password: 's3cret',
          database: 'shop',
        },
        ignoredOptions: [],
      },
    ],
    [
      'mysql://us%40er:p%40ss@[::1]/my%20db?ssl-mode=REQUIRED&charset=utf8',
      {
        kind: 'url',
        fields: { host: '::1', port: 3306, username: 'us@er', password: 'p@ss', database: 'my db' },
        ignoredOptions: ['ssl-mode', 'charset'],
      },
    ],
    [
      'mysql://localhost',
      {
        kind: 'url',
        fields: { host: 'localhost', port: 3306, username: '', password: '', database: null },
        ignoredOptions: [],
      },
    ],
    ['mysqlx://root@localhost', { kind: 'rejected', reason: MYSQL_X_REJECTED_REASON }],
    ['postgres://localhost/db', { kind: 'rejected', reason: OTHER_SCHEME_REJECTED_REASON }],
    ['mysql://host:99999', { kind: 'rejected', reason: UNREADABLE_URL_REASON }],
    ['mysql:///db', { kind: 'rejected', reason: MISSING_HOST_REASON }],
  ])('reads %s', (text, expected) => {
    expect(parseConnectionComposerText(text)).toEqual(expected)
  })
})

describe('formatConnectionUrl', () => {
  it('writes user, bracketed IPv6 host, port and database without a password', () => {
    expect(
      formatConnectionUrl({ host: '::1', port: 3306, username: 'us@er', defaultDatabase: 'my db' })
    ).toBe('mysql://us%40er@[::1]:3306/my%20db')
    expect(
      formatConnectionUrl({ host: 'db', port: 3307, username: '', defaultDatabase: null })
    ).toBe('mysql://db:3307')
  })
})
