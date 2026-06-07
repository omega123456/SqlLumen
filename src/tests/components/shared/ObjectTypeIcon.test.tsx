import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ObjectTypeIcon } from '../../../components/shared/ObjectTypeIcon'

describe('ObjectTypeIcon', () => {
  it.each(['table', 'view', 'procedure', 'function', 'trigger'] as const)(
    'renders the %s icon variant',
    (objectType) => {
      render(<ObjectTypeIcon objectType={objectType} />)

      expect(screen.getByTestId(`object-type-icon-${objectType}`)).toBeInTheDocument()
    }
  )
})
