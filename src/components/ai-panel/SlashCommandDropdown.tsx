import type { SlashCommand } from '../../lib/slash-commands'
import styles from './SlashCommandDropdown.module.css'

export interface SlashCommandDropdownProps {
  commands: SlashCommand[]
  highlightedIndex: number
  onSelect: (command: SlashCommand) => void
  onHighlightChange: (index: number) => void
}

export function SlashCommandDropdown({
  commands,
  highlightedIndex,
  onSelect,
  onHighlightChange,
}: SlashCommandDropdownProps) {
  if (commands.length === 0) return null

  return (
    <div
      role="listbox"
      id="slash-command-listbox"
      className={styles.dropdown}
      data-testid="slash-command-dropdown"
    >
      {commands.map((cmd, i) => (
        <div
          key={cmd.name}
          role="option"
          id={`slash-cmd-${cmd.name}`}
          aria-selected={i === highlightedIndex}
          className={`${styles.item} ${i === highlightedIndex ? styles.itemHighlighted : ''}`}
          data-testid={`slash-command-item-${cmd.name}`}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => onHighlightChange(i)}
        >
          <span className={styles.commandName}>/{cmd.name}</span>
          <span className={styles.commandDescription}>{cmd.description}</span>
        </div>
      ))}
    </div>
  )
}
