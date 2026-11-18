import type { ReactNode } from 'react'
import { PencilSimple } from '@phosphor-icons/react'
import { Button } from '../../common/Button'
import { dataFlag } from '../../../lib/data-attributes'
import { PAGE_ICON_SIZE } from '../page-icons'
import { PROFILE_SECTION_TITLE, type ProfileSection as SectionId } from './profile-sections'

interface ProfileSectionProps {
  section: SectionId
  isEditing: boolean
  onEdit: () => void
  children: ReactNode
}

function EditButton({ section, onEdit }: { section: SectionId; onEdit: () => void }) {
  return (
    <Button variant="subtle" onClick={onEdit} aria-label={`Edit ${PROFILE_SECTION_TITLE[section]}`}>
      <PencilSimple size={PAGE_ICON_SIZE} aria-hidden className="shrink-0" />
      Edit
    </Button>
  )
}

export function ProfileSection({ section, isEditing, onEdit, children }: ProfileSectionProps) {
  return (
    <section
      className="flex min-w-0 flex-col gap-4 border-t border-light-stroke-divider pt-5 dark:border-dark-stroke-divider"
      aria-label={PROFILE_SECTION_TITLE[section]}
      data-testid={`profile-section-${section}`}
      data-editing={dataFlag(isEditing)}
    >
      <div className="flex h-8 items-center justify-between gap-2">
        <h2 className="font-headline text-subtitle font-semibold text-light-on-surface dark:text-dark-on-surface">
          {PROFILE_SECTION_TITLE[section]}
        </h2>
        {!isEditing && <EditButton section={section} onEdit={onEdit} />}
      </div>
      <dl className="grid grid-cols-connection-facts items-start gap-x-4 gap-y-3">{children}</dl>
    </section>
  )
}
