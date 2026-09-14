import { useState } from "react";
import { api } from "../lib/api";
import type { GenOpts } from "../lib/types";
import { CopyIcon, CheckIcon, XIcon } from "./Icon";
import { useHotkey } from "../lib/useHotkey";

interface Props {
  onClose: () => void;
}

const defaults: GenOpts = { length: 20, lower: true, upper: true, digits: true, symbols: true };

const CLASSES: { key: keyof Omit<GenOpts, "length">; label: string }[] = [
  { key: "lower", label: "a-z" },
  { key: "upper", label: "A-Z" },
  { key: "digits", label: "0-9" },
  { key: "symbols", label: "!@#" },
];

export default function Generator({ onClose }: Props) {
  const [opts, setOpts] = useState<GenOpts>(defaults);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useHotkey("escape", onClose);

  async function generate() {
    try {
      const v = await api.generatePassword(opts);
      setValue(v);
      setError(null);
    } catch (e: any) {
      setError(String(e));
    }
  }

  async function copy() {
    if (!value) return;
    try {
      await api.copyToClipboard(value, 30);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (e: any) {
      setError(String(e));
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-5"
      onClick={onClose}
    >
      <div className="dialog flex w-full max-w-[420px] flex-col gap-4 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-headline-sm text-on-surface">New password</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-control p-1.5 text-on-surface-variant hover:bg-white/4">
            <XIcon size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="label-md">Length</p>
            <p className="font-mono text-body-sm text-primary">{opts.length}</p>
          </div>
          <input
            type="range"
            min={4}
            max={64}
            value={opts.length}
            onChange={(e) => setOpts({ ...opts, length: Number(e.target.value) })}
            aria-label="Password length"
            className="h-1 w-full appearance-none rounded-full bg-surface-container-high accent-primary"
          />
        </div>

        <div className="flex flex-wrap gap-3" role="group" aria-label="Character classes">
          {CLASSES.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-body-md text-on-surface-variant">
              <input
                type="checkbox"
                checked={opts[key]}
                onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })}
                aria-label={key}
                className="h-4 w-4 accent-primary"
              />
              {label}
            </label>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={value}
            placeholder="Click Generate"
            className="field flex-1 font-mono"
          />
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={generate}>
            Generate
          </button>
          <button type="button" className="btn-primary flex-1" onClick={copy} disabled={!value}>
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {error && (
          <p role="alert" className="text-body-sm text-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
