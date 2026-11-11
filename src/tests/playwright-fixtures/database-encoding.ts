import type { CharsetInfo, CollationInfo, DatabaseDetails } from '../../types/schema'
import { PLAYWRIGHT_MOCK_DATABASE } from './connections'

export const DATABASE_DETAILS: DatabaseDetails = {
  name: PLAYWRIGHT_MOCK_DATABASE,
  defaultCharacterSet: 'utf8mb4',
  defaultCollation: 'utf8mb4_general_ci',
}

export const CHARSETS: CharsetInfo[] = [
  {
    charset: 'utf8mb4',
    description: 'UTF-8 Unicode',
    defaultCollation: 'utf8mb4_general_ci',
    maxLength: 4,
  },
]

export const COLLATIONS: CollationInfo[] = [
  { name: 'utf8mb4_general_ci', charset: 'utf8mb4', isDefault: true },
]
