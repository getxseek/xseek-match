import { Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export type ToastMessage = {
  id: number;
  text: string;
};

export function useToast(timeoutMs = 3000) {
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), timeoutMs);
    return () => clearTimeout(timer);
  }, [toast, timeoutMs]);

  function notify(text: string) {
    setToast({ id: Date.now(), text });
  }

  function dismiss() {
    setToast(null);
  }

  return { toast, notify, dismiss };
}

export function SettingsToast({
  toast,
  onDismiss,
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
}) {
  if (!toast) return null;

  return createPortal(
    <div className="settings-toast" role="status" key={toast.id}>
      <Check size={16} strokeWidth={2.5} />
      <span>{toast.text}</span>
      <button type="button" aria-label="Dismiss notification" onClick={onDismiss}>
        <X size={14} />
      </button>
    </div>,
    document.body,
  );
}
