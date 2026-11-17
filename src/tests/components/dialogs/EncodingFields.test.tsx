import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EncodingFields } from '../../../components/dialogs/EncodingFields'
import type { UseDatabaseEncodingReturn } from '../../../hooks/useDatabaseEncoding'

function buildEncoding(
  overrides: Partial<UseDatabaseEncodingReturn> = {}
): UseDatabaseEncodingReturn {
  return {
    charsets: [
      {
        charset: 'utf8mb4',
        description: 'UTF-8 Unicode',
        defaultCollation: 'utf8mb4_0900_ai_ci',
        maxLength: 4,
      },
    ],
    collations: [],
    filteredCollations: [
      { name: 'utf8mb4_0900_ai_ci', charset: 'utf8mb4', isDefault: true },
      { name: 'utf8mb4_bin', charset: 'utf8mb4', isDefault: false },
    ],
    charset: '',
    collation: '',
    setCharset: vi.fn(),
    setCollation: vi.fn(),
    isLoading: false,
    error: null,
    ...overrides,
  }
}

describe('EncodingFields', () => {
  it('labels the charset and collation dropdowns with the id prefix', () => {
    render(<EncodingFields idPrefix="test-db" encoding={buildEncoding()} />)

    expect(screen.getByRole('combobox', { name: 'Character set' })).toHaveAttribute(
      'id',
      'test-db-charset'
    )
    expect(screen.getByRole('combobox', { name: 'Collation' })).toHaveAttribute(
      'id',
      'test-db-collation'
    )
  })

  it('shows the server default and default options when nothing is selected', () => {
    render(<EncodingFields idPrefix="test-db" encoding={buildEncoding()} />)

    expect(screen.getByRole('combobox', { name: 'Character set' })).toHaveTextContent(
      'Server default'
    )
    expect(screen.getByRole('combobox', { name: 'Collation' })).toHaveTextContent('Default')
  })
})
