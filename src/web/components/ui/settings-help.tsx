import { useEffect, useLayoutEffect, useRef, useState, useId } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

export function SettingsHelp({ label, children }: { label: string; children: string }) {
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ left: 0, top: 0 });
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancelClose = () => clearTimeout(closeTimer.current);
  const delayedClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (document.activeElement !== button.current) setOpen(false);
    }, 150);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const button = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLSpanElement>(null),
    id = useId();
  useLayoutEffect(() => {
    if (!open || !button.current || !panel.current) return;
    const rect = button.current.getBoundingClientRect(),
      box = panel.current.getBoundingClientRect();
    setPosition({
      left: Math.max(12, Math.min(rect.left, window.innerWidth - box.width - 12)),
      top:
        rect.bottom + 8 + box.height < window.innerHeight
          ? rect.bottom + 8
          : Math.max(12, rect.top - box.height - 8),
    });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !button.current?.contains(event.target as Node) &&
        !panel.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);
  return (
    <span
      className="settings-help"
      onMouseEnter={() => {
        cancelClose();
        setOpen(true);
      }}
      onMouseLeave={delayedClose}
    >
      <button
        ref={button}
        type="button"
        aria-label={`About ${label}`}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Info size={14} strokeWidth={2} />
      </button>
      {open &&
        createPortal(
          <span
            ref={panel}
            id={id}
            onMouseEnter={cancelClose}
            onMouseLeave={delayedClose}
            className="settings-help-popover"
            role="tooltip"
            style={position}
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
