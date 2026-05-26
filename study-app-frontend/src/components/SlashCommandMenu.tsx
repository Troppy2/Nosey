import { CornerDownLeft, Sparkles } from "lucide-react";

export type CommandOption = {
  slash: string;
  label: string;
  description: string;
  prompt: string;
  actionType?: "chat" | "blueprint";
};

type Props = {
  commands: CommandOption[];
  activeIndex: number;
  onSelect: (command: CommandOption) => void;
};

export function SlashCommandMenu({ commands, activeIndex, onSelect }: Props) {
  if (commands.length === 0) return null;

  return (
    <div className="slash-menu" role="listbox" aria-label="Slash commands">
      {commands.map((command, index) => (
        <button
          key={command.slash}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          className={`slash-menu-item${index === activeIndex ? " slash-menu-item--active" : ""}`}
          onClick={() => onSelect(command)}
        >
          <span className="slash-menu-icon" aria-hidden="true">
            <Sparkles size={15} />
          </span>
          <span className="slash-menu-copy">
            <span className="slash-menu-item-top">
              <span>{command.label}</span>
              <strong>{command.slash}</strong>
            </span>
            <small>{command.description}</small>
          </span>
          <span className="slash-menu-run" aria-hidden="true">
            <CornerDownLeft size={13} />
          </span>
        </button>
      ))}
    </div>
  );
}
