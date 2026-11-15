import type { SlashCommand } from '../../lib/slash-commands'
import { joinClassNames } from '../../lib/class-names'
import { AI_COMPOSER_POPUP } from '../../lib/class-names-ai'
import { LISTBOX_OPTION_STATE_CLASSES, listboxOptionState } from '../../lib/class-names-menu'

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
      className={joinClassNames([AI_COMPOSER_POPUP, 'min-w-50'])}
      data-testid="slash-command-dropdown"
    >
      {commands.map((command, index) => (
        <div
          key={command.name}
          role="option"
          id={`slash-cmd-${command.name}`}
          aria-selected={index === highlightedIndex}
          className={joinClassNames([
            'flex cursor-pointer flex-col gap-0.5 px-3 py-2',
            LISTBOX_OPTION_STATE_CLASSES[listboxOptionState(index === highlightedIndex)],
          ])}
          data-testid={`slash-command-item-${command.name}`}
          onClick={() => onSelect(command)}
          onMouseEnter={() => onHighlightChange(index)}
        >
          <span className="text-size-row font-semibold text-light-on-surface dark:text-dark-on-surface">
            /{command.name}
          </span>
          <span className="text-light-on-surface-variant dark:text-dark-on-surface-variant">
            {command.description}
          </span>
        </div>
      ))}
    </div>
  )
}
