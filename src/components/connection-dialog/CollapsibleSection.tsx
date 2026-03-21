import { useState, useId } from 'react'
import { CaretRight } from '@phosphor-icons/react'
import styles from './CollapsibleSection.module.css'

interface CollapsibleSectionProps {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  /** Optional hook for e2e / visual tests */
  sectionTestId?: string
}

export function CollapsibleSection({
  title,
  children,
  defaultOpen = false,
  sectionTestId,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const id = useId()
  const triggerId = `${id}-trigger`
  const contentId = `${id}-content`

  return (
    <div className={`ui-subsection ${styles.section}`} data-testid={sectionTestId}>
      <button
        id={triggerId}
        type="button"
        className={styles.trigger}
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <CaretRight
          size={14}
          weight="bold"
          className={`${styles.icon} ${isOpen ? styles.iconOpen : ''}`}
        />
        <span className={styles.title}>{title}</span>
      </button>
      <div
        id={contentId}
        className={`${styles.content} ${isOpen ? styles.contentOpen : ''}`}
        role="region"
        aria-labelledby={triggerId}
        aria-hidden={!isOpen}
        inert={!isOpen}
      >
        <div className={styles.contentInner}>
          <div className={styles.contentPadding}>{children}</div>
        </div>
      </div>
    </div>
  )
}
