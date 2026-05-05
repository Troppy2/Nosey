export type SlashCommand = {
  slash: string;
  label: string;
  description: string;
  prompt: string;
};

type Props = {
  commands: SlashCommand[];
  query: string;
  onSelect: (command: SlashCommand) => void;
};

export function SlashCommandMenu({ commands, query, onSelect }: Props) {
  const normalized = query.trim().toLowerCase().replace(/^\//, "");
  const visible = commands.filter((command) => {
    if (!normalized) return true;
    return command.slash.toLowerCase().includes(normalized) || command.label.toLowerCase().includes(normalized);
  });

  if (visible.length === 0) return null;

  return (
    <div className="slash-menu" role="listbox" aria-label="Slash commands">
      {visible.map((command) => (
        <button
          key={command.slash}
          type="button"
          className="slash-menu-item"
          onClick={() => onSelect(command)}
        >
          <span className="slash-menu-item-top">
            <strong>{command.slash}</strong>
            <span>{command.label}</span>
          </span>
          <small>{command.description}</small>
        </button>
      ))}
    </div>
  );
}
