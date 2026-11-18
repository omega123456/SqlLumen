import type { KeyboardEvent, ReactNode } from 'react'
import { LinkSimple, MagnifyingGlass, WarningCircle } from '@phosphor-icons/react'
import { TextInput } from '../../common/TextInput'
import type { ComposerText } from '../../../lib/mysql-connection-url'
import { COMPOSER_ICON_SIZE } from '../page-icons'
import { UrlReview } from './UrlReview'
import type { useUrlImport } from './use-url-import'

export const COMPOSER_INPUT_ID = 'connections-composer'

interface ConnectionComposerProps {
  text: string
  parsed: ComposerText
  urlImport: ReturnType<typeof useUrlImport>
  onTextChange: (text: string) => void
}

const COMPOSER_ICONS: Record<ComposerText['kind'], ReactNode> = {
  search: <MagnifyingGlass size={COMPOSER_ICON_SIZE} aria-hidden />,
  url: <LinkSimple size={COMPOSER_ICON_SIZE} aria-hidden />,
  rejected: <WarningCircle size={COMPOSER_ICON_SIZE} aria-hidden />,
}

function ComposerFeedback({ parsed, urlImport, onTextChange }: ConnectionComposerProps) {
  if (parsed.kind === 'rejected') {
    return (
      <span className="text-row text-light-error dark:text-dark-error" role="alert">
        {parsed.reason}
      </span>
    )
  }
  if (parsed.kind !== 'url') return null
  return (
    <UrlReview
      fields={parsed.fields}
      ignoredOptions={parsed.ignoredOptions}
      isSaving={urlImport.isSaving}
      onSaveAndConnect={() => void urlImport.saveAndConnect(parsed.fields)}
      onReviewAll={() => urlImport.reviewAll(parsed.fields)}
      onCancel={() => onTextChange('')}
    />
  )
}

function hasText(event: KeyboardEvent<HTMLInputElement>): boolean {
  return event.currentTarget.value !== ''
}

export function ConnectionComposer(props: ConnectionComposerProps) {
  const clearOnEscape = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return
    if (!hasText(event)) return
    event.preventDefault()
    props.onTextChange('')
  }

  return (
    <div className="flex max-w-connections-composer flex-col gap-2">
      <label
        htmlFor={COMPOSER_INPUT_ID}
        className="text-row text-light-on-surface-variant dark:text-dark-on-surface-variant"
      >
        Find a saved server, or paste a connection URL to add one
      </label>
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute left-3 flex text-light-outline dark:text-dark-outline">
          {COMPOSER_ICONS[props.parsed.kind]}
        </span>
        <TextInput
          id={COMPOSER_INPUT_ID}
          variant="composer"
          value={props.text}
          onChange={(event) => props.onTextChange(event.target.value)}
          onKeyDown={clearOnEscape}
          placeholder="orders, 10.20.4.17 or mysql://user@host:3306/db"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          data-testid="connections-composer"
        />
      </div>
      <ComposerFeedback {...props} />
    </div>
  )
}
