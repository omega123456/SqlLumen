import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TableDataPlaceholder } from '../../../components/workspace/TableDataPlaceholder'

describe('TableDataPlaceholder', () => {
  it('renders the object name (database.table)', () => {
    render(<TableDataPlaceholder databaseName="mydb" tableName="users" />)

    expect(screen.getByText('mydb.users')).toBeInTheDocument()
  })

  it('renders the placeholder message', () => {
    render(<TableDataPlaceholder databaseName="mydb" tableName="users" />)

    expect(screen.getByText('Table data viewing will be available in Phase 6')).toBeInTheDocument()
  })

  it('has the correct data-testid', () => {
    render(<TableDataPlaceholder databaseName="ecommerce" tableName="orders" />)

    expect(screen.getByTestId('table-data-placeholder')).toBeInTheDocument()
  })

  it('shows different database and table names', () => {
    render(<TableDataPlaceholder databaseName="analytics" tableName="events" />)

    expect(screen.getByText('analytics.events')).toBeInTheDocument()
  })
})
