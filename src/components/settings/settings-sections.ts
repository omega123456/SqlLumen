import {
  GearSix,
  Code,
  Table,
  FileText,
  Keyboard,
  Sparkle,
  ArrowsClockwise,
} from '@phosphor-icons/react'
import type { SettingsSection } from '../../types/schema'

export const SETTINGS_SECTIONS: { id: SettingsSection; label: string; Icon: typeof GearSix }[] = [
  { id: 'general', label: 'General', Icon: GearSix },
  { id: 'editor', label: 'Editor', Icon: Code },
  { id: 'results', label: 'Results', Icon: Table },
  { id: 'logging', label: 'Logging', Icon: FileText },
  { id: 'shortcuts', label: 'Shortcuts', Icon: Keyboard },
  { id: 'ai', label: 'AI', Icon: Sparkle },
  { id: 'updates', label: 'Updates', Icon: ArrowsClockwise },
]
