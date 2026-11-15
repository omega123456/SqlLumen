import type { SettingsSection } from '../../types/schema'
import { SETTINGS_SECTIONS } from './settings-sections'
import { Button } from '../common/Button'
import { SCROLLBAR, joinClassNames } from '../../lib/class-names'
import { FOCUS_RING } from '../../lib/focus-ring'

export interface SettingsSidebarProps {
  activeSection: SettingsSection
  onSelect: (section: SettingsSection) => void
}

type NavButtonState = 'active' | 'inactive'

const NAV_BUTTON_STATE_CLASSES: Record<NavButtonState, string> = {
  active:
    'bg-light-fill-neutral-selected before:absolute before:top-1/2 before:left-0 before:-mt-2 before:h-4 before:w-0.75 before:rounded-track before:bg-light-primary dark:bg-dark-fill-neutral-selected dark:before:bg-dark-primary',
  inactive: 'bg-transparent hover:bg-light-fill-subtle-hover dark:hover:bg-dark-fill-subtle-hover',
}

function navButtonState(isActive: boolean): NavButtonState {
  if (isActive) return 'active'
  return 'inactive'
}

export function SettingsSidebar({ activeSection, onSelect }: SettingsSidebarProps) {
  return (
    <nav
      className={joinClassNames([
        'flex w-60 min-w-60 flex-col gap-0.5 overflow-y-auto px-2 py-1',
        SCROLLBAR,
      ])}
      data-testid="settings-sidebar"
      aria-label="Settings sections"
    >
      {SETTINGS_SECTIONS.map(({ id, label, Icon }) => (
        <Button
          variant="bare"
          key={id}
          className={joinClassNames([
            'relative flex h-9 w-full flex-none cursor-default items-center gap-3 rounded-control px-3 text-left font-body text-body font-regular text-light-on-surface dark:text-dark-on-surface',
            FOCUS_RING,
            NAV_BUTTON_STATE_CLASSES[navButtonState(activeSection === id)],
          ])}
          data-active={activeSection === id}
          data-testid={`settings-nav-${id}`}
          onClick={() => onSelect(id)}
          aria-current={activeSection === id ? 'true' : undefined}
        >
          <span className="flex shrink-0 items-center">
            <Icon size={16} weight="regular" />
          </span>
          {label}
        </Button>
      ))}
    </nav>
  )
}
