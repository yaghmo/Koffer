import { useState } from "react";
import { api } from "../lib/api";
import type { GenOpts } from "../lib/types";
import { CopyIcon, CheckIcon, XIcon } from "./Icon";

interface Props {
  onClose: () => void;
}

const defaults: GenOpts = {
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
};

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
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <p className="meta">Generate</p>
        <h2>New password</h2>

        <div>
          <p className="field-label" style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Length</span>
            <span style={{ color: "var(--amber-200)" }}>{opts.length}</span>
          </p>
          <input
            type="range"
            min={4}
            max={64}
            value={opts.length}
            onChange={(e) => setOpts({ ...opts, length: Number(e.target.value) })}
            aria-label="Password length"
          />
        </div>

        <div className="checkboxes" role="group" aria-label="Character classes">
          {CLASSES.map(({ key, label }) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={opts[key]}
                onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })}
                aria-label={key}
              />
              {label}
            </label>
          ))}
        </div>

        <div className="row">
          <input
            type="text"
            readOnly
            value={value}
            placeholder="Click Generate"
            className="generated"
          />
          <button type="button" className="btn" onClick={generate}>
            Generate
          </button>
          <button
            type="button"
            className="btn btn-cool"
            onClick={copy}
            disabled={!value}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        <div className="actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            <XIcon /> Close
          </button>
        </div>
      </div>
    </div>
  );
}
