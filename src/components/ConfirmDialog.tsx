import { useState } from "react";
import { useHotkey } from "../lib/useHotkey";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  /** When set, the confirm button stays disabled until the user types this word exactly. */
  typeToConfirm?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  typeToConfirm,
  onConfirm,
  onCancel,
}: Props) {
  const [typed, setTyped] = useState("");
  useHotkey("escape", onCancel);
  const locked = typeToConfirm !== undefined && typed !== typeToConfirm;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-5"
      onClick={onCancel}
    >
      <div className="dialog flex w-full max-w-[380px] flex-col gap-4 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-headline-sm text-on-surface">{title}</h2>
        <p className="text-body-sm text-on-surface-variant">{message}</p>
        {typeToConfirm !== undefined && (
          <div className="flex flex-col gap-1.5">
            <p className="label-md">
              Type <span className="font-mono text-error">{typeToConfirm}</span> to confirm
            </p>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              aria-label={`Type ${typeToConfirm} to confirm`}
              className="field font-mono"
            />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm} disabled={locked}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
