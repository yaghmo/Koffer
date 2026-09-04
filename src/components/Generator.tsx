import { useState } from "react";
import { api } from "../lib/api";
import type { GenOpts } from "../lib/types";

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

export default function Generator({ onClose }: Props) {
  const [opts, setOpts] = useState<GenOpts>(defaults);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

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
    await api.copyToClipboard(value, 30);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Generate password</h2>

        <label>
          Length: {opts.length}
          <input
            type="range"
            min={4}
            max={64}
            value={opts.length}
            onChange={(e) => setOpts({ ...opts, length: Number(e.target.value) })}
          />
        </label>

        <div className="checkboxes">
          {(["lower", "upper", "digits", "symbols"] as const).map((k) => (
            <label key={k} className="check">
              <input
                type="checkbox"
                checked={opts[k]}
                onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })}
              />
              {k}
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
          <button type="button" onClick={generate}>
            Generate
          </button>
          <button type="button" onClick={copy} disabled={!value}>
            Copy
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="row right">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
