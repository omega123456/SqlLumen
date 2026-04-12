import { GearSix, Code, Table, FileText, Keyboard, Sparkle } from '@phosphor-icons/react'
import type { SettingsSection } from '../../types/schema'
import styles from './SettingsSidebar.module.css'

const SECTIONS: { id: SettingsSection; label: string; Icon: typeof GearSix }[] = [
  { id: 'general', label: 'General', Icon: GearSix },
  { id: 'editor', label: 'Editor', Icon: Code },
  { id: 'results', label: 'Results', Icon: Table },
  { id: 'logging', label: 'Logging', Icon: FileText },
  { id: 'shortcuts', label: 'Shortcuts', Icon: Keyboard },
  { id: 'ai', label: 'AI', Icon: Sparkle },
]

export interface SettingsSidebarProps {
  activeSection: SettingsSection
  onSelect: (section: SettingsSection) => void
}

export function SettingsSidebar({ activeSection, onSelect }: SettingsSidebarProps) {
  return (
    <nav className={styles.sidebar} data-testid="settings-sidebar" aria-label="Settings sections">
      {SECTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={styles.navButton}
          data-active={activeSection === id}
          data-testid={`settings-nav-${id}`}
          onClick={() => onSelect(id)}
          aria-current={activeSection === id ? 'true' : undefined}
        >
          <span className={styles.navButtonIcon}>
            <Icon size={18} weight="regular" />
          </span>
          {label}
        </button>
      ))}
    </nav>
  )
}
