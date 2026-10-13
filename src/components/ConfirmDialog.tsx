import { useState } from "react";
import { useHotkey } from "../lib/useHotkey";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When set, the confirm button stays disabled until the user types this word exactly. */
  typeToConfirm?: string;
  /** "danger" (the default) for answers that destroy something: the dialog is
   *  taped and confirms in ink. "primary" when saying yes is the ordinary
   *  thing to do, so the button is the red primary. */
  tone?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  typeToConfirm,
  tone = "danger",
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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6"
      onClick={onCancel}
    >
      <div
        className={`dialog flex w-full max-w-[380px] flex-col gap-4 p-6 ${tone === "danger" ? "dialog-danger" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-headline-sm text-on-surface">{title}</h2>
        <p className="text-body-sm text-on-surface-variant">{message}</p>
        {typeToConfirm !== undefined && (
          <div className="flex flex-col gap-1">
            <p className="label-md">
              Type <span className="font-mono font-medium text-on-surface">{typeToConfirm}</span> to confirm
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
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === "danger" ? "btn-ink" : "btn-primary"}
            onClick={onConfirm}
            disabled={locked}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
