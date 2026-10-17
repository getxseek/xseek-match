type SwitchButtonProps = {
  id?: string;
  label?: string;
  checked: boolean;
  disabled?: boolean;
  className?: string;
  onToggle: () => void;
};

export function SwitchButton({
  id,
  label,
  checked,
  disabled,
  className = 'indexer-toggle',
  onToggle,
}: SwitchButtonProps) {
  return (
    <button
      id={id}
      type="button"
      className={className}
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
    >
      <span />
    </button>
  );
}
