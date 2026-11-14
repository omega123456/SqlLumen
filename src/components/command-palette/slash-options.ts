import type { PaletteTypeFilter } from '../../types/schema'
import type { CommandPaletteFilterPillValue } from './palette-types'

interface SlashKeywordOption {
  value: PaletteTypeFilter
  label: string
  alias: string
  aliases: string[]
}

const KEYWORD_OPTIONS: SlashKeywordOption[] = [
  { value: 'table', label: 'Tables', alias: '/table', aliases: ['table'] },
  { value: 'view', label: 'Views', alias: '/view', aliases: ['view'] },
  {
    value: 'procedure',
    label: 'Stored Procedures',
    alias: '/sproc',
    aliases: ['sproc', 'procedure', 'proc'],
  },
  { value: 'function', label: 'Functions', alias: '/func', aliases: ['func', 'function'] },
  { value: 'trigger', label: 'Triggers', alias: '/trigger', aliases: ['trigger'] },
]

export const TYPE_FILTER_OPTIONS: CommandPaletteFilterPillValue[] = KEYWORD_OPTIONS.map(
  (option) => ({ kind: 'object-type', value: option.value, label: option.label })
)

export const TYPE_ALIASES: ReadonlyMap<string, CommandPaletteFilterPillValue> = new Map(
  KEYWORD_OPTIONS.flatMap((option, index) =>
    option.aliases.map((alias) => [alias, TYPE_FILTER_OPTIONS[index]] as const)
  )
)

export interface SlashOption {
  id: string
  pill: CommandPaletteFilterPillValue
  meta: string
  kind: 'keyword' | 'database'
}

function isKeywordOptionMatch(option: SlashKeywordOption, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) {
    return true
  }
  if (option.aliases.some((alias) => alias.includes(normalizedQuery))) {
    return true
  }
  return option.label.toLowerCase().includes(normalizedQuery)
}

export function buildSlashOptions(
  slashQuery: string,
  databases: ReadonlyArray<string>
): SlashOption[] {
  const normalizedQuery = slashQuery.trim().toLowerCase()
  const keywordOptions = KEYWORD_OPTIONS.filter((option) =>
    isKeywordOptionMatch(option, normalizedQuery)
  ).map((option) => ({
    id: `keyword-${option.value}`,
    pill: {
      kind: 'object-type' as const,
      value: option.value,
      label: option.label,
    },
    meta: option.alias,
    kind: 'keyword' as const,
  }))

  const databaseOptions = databases
    .filter((database) => {
      if (normalizedQuery.length === 0) {
        return true
      }

      return database.toLowerCase().includes(normalizedQuery)
    })
    .map((database) => ({
      id: `database-${database}`,
      pill: {
        kind: 'database' as const,
        value: database,
        label: database,
      },
      meta: '/db',
      kind: 'database' as const,
    }))

  return [...keywordOptions, ...databaseOptions]
}
