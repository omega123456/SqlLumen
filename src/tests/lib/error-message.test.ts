import { describe, expect, it } from 'vitest'
import {
  describeQueryFailure,
  QUERY_CANCELLED_MESSAGE,
  toErrorMessage,
} from '../../lib/error-message'

describe('toErrorMessage', () => {
  it('returns the message of an Error', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('stringifies any other thrown value', () => {
    expect(toErrorMessage('plain failure')).toBe('plain failure')
    expect(toErrorMessage(42)).toBe('42')
  })
})

describe('describeQueryFailure', () => {
  it('reports a cancellation when the query was cancelled', () => {
    expect(describeQueryFailure(true, new Error('Lost connection'))).toBe(QUERY_CANCELLED_MESSAGE)
  })

  it('reports the error message otherwise', () => {
    expect(describeQueryFailure(false, new Error('Syntax error'))).toBe('Syntax error')
  })
})
