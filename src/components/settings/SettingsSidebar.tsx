import type { SettingsSection } from '../../types/schema'
import { SETTINGS_SECTIONS } from './settings-sections'
import styles from './SettingsSidebar.module.css'

export interface SettingsSidebarProps {
  activeSection: SettingsSection
  onSelect: (section: SettingsSection) => void
}

export function SettingsSidebar({ activeSection, onSelect }: SettingsSidebarProps) {
  return (
    <nav className={styles.sidebar} data-testid="settings-sidebar" aria-label="Settings sections">
      {SETTINGS_SECTIONS.map(({ id, label, Icon }) => (
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
            <Icon size={16} weight="regular" />
          </span>
          {label}
        </button>
      ))}
    </nav>
  )
}
