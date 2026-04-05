import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ForeignKeysPanel } from '../../../components/schema-info/ForeignKeysPanel'
import type { ForeignKeyInfo } from '../../../types/schema'

function makeFk(overrides: Partial<ForeignKeyInfo> = {}): ForeignKeyInfo {
  return {
    name: 'fk_order_user',
    columnName: 'user_id',
    referencedDatabase: 'testdb',
    referencedTable: 'users',
    referencedColumn: 'id',
    onDelete: 'CASCADE',
    onUpdate: 'NO ACTION',
    ...overrides,
  }
}

describe('ForeignKeysPanel', () => {
  it('renders FK rows', () => {
    const foreignKeys = [
      makeFk({ name: 'fk_order_user' }),
      makeFk({ name: 'fk_order_product', columnName: 'product_id', referencedTable: 'products' }),
    ]

    render(<ForeignKeysPanel foreignKeys={foreignKeys} />)

    expect(screen.getByTestId('foreign-keys-panel')).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    // 1 header + 2 data rows
    expect(rows).toHaveLength(3)
    expect(screen.getByText('fk_order_user')).toBeInTheDocument()
    expect(screen.getByText('fk_order_product')).toBeInTheDocument()
  })

  it('shows empty state when no FKs', () => {
    render(<ForeignKeysPanel foreignKeys={[]} />)

    expect(screen.getByTestId('foreign-keys-panel')).toBeInTheDocument()
    expect(screen.getByText('No foreign keys defined on this table')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('displays FK details correctly', () => {
    const foreignKeys = [makeFk()]

    render(<ForeignKeysPanel foreignKeys={foreignKeys} />)

    expect(screen.getByText('user_id')).toBeInTheDocument()
    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('id')).toBeInTheDocument()
    expect(screen.getByText('CASCADE')).toBeInTheDocument()
    expect(screen.getByText('NO ACTION')).toBeInTheDocument()
  })
})
