import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { PersonalInfo } from "../lib/types";
import type { Item, ItemKind, ItemMeta, LoginFields, LoginMethod, NoteFields, CardFields } from "../lib/types";
import { CopyIcon, CheckIcon, EyeIcon, EyeOffIcon, XIcon } from "../components/Icon";
import { methods, MethodChip, accountMatchesProvider, methodLabel } from "../lib/methods";

interface Props {
  id: string | null;
  initialKind?: ItemKind;
  onClose: () => void;
  onSaved?: () => void;
}

const emptyLogin = (): LoginFields => ({ method: "credentials", url: "", username: "", password: "" });
const emptyNote = (): NoteFields => ({ body: "" });
const emptyCard = (): CardFields => ({ cardholder: "", number: "", exp: "", cvv: "" });

// Accept http(s) URLs only, with a host. Empty is allowed (URL is optional).
function isValidUrl(s: string): boolean {
  if (!s.trim()) return true;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Card expiration: MM/YY only (2 digits slash 2 digits). Must be complete or empty.
function isValidExp(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  // MM/YY exactly, or incomplete (1-4 digits, possibly with slash) if not submitting
  return /^\d{2}\/\d{2}$/.test(t);
}

// Format card number as user types: "1234567890123456" → "1234-5678-9012-3456".
function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 16);
  const parts = [];
  for (let i = 0; i < digits.length; i += 4) {
    parts.push(digits.slice(i, i + 4));
  }
  return parts.join("-");
}

// Format exp as user types: "0125" → "01/25", "1" → "1", "12" → "12/".
function formatCardExp(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length >= 3) {
    return digits.slice(0, 2) + "/" + digits.slice(2, 4);
  }
  return digits;
}

export default function ItemEditor({ id, initialKind, onClose, onSaved }: Props) {
  const [kind, setKind] = useState<ItemKind>(initialKind ?? "login");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [login, setLogin] = useState<LoginFields>(emptyLogin());
  const [note, setNote] = useState<NoteFields>(emptyNote());
  const [card, setCard] = useState<CardFields>(emptyCard());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  // Passwords are masked by default; the reveal toggle shows them in the clear.
  const [showPassword, setShowPassword] = useState(false);

  // URL metadata (favicon + title) fetched on paste
  const [favicon, setFavicon] = useState<string | null>(null);
  const [fetchingMeta, setFetchingMeta] = useState(false);

  // Provider account suggestions + nested "+ Add new account" sub-flow
  const [accountSuggestions, setAccountSuggestions] = useState<ItemMeta[]>([]);
  const [creatingAccount, setCreatingAccount] = useState(false);

  // Global personal profile — offers email/phone/username as quick-fill chips.
  const [personalInfo, setPersonalInfo] = useState<{ email: string; phone: string; username: string }>({ email: "", phone: "", username: "" });

  useEffect(() => {
    let cancelled = false;
    api
      .getPersonalInfo()
      .then((p) => {
        if (cancelled) return;
        setPersonalInfo({ email: p.email, phone: p.phone, username: p.username });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (id === null) return;
    api.getItem(id).then((item) => {
      setKind(item.type);
      setTitle(item.title);
      setNotes(item.notes);
      setFavicon(item.favicon || null);
      if (item.type === "login") {
        setLogin({
          method: item.method || "credentials",
          url: item.url,
          username: item.username,
          password: item.password,
        });
      } else if (item.type === "note") {
        setNote({ body: item.body });
      } else {
        setCard({
          cardholder: item.cardholder,
          number: item.number,
          exp: item.exp,
          cvv: item.cvv,
        });
      }
    }).catch((err) => {
      setError(`Failed to load item: ${err}`);
    });
  }, [id]);

  // Load provider-matching accounts when a non-credentials method is chosen.
  // The list of all credential logins already in the vault is filtered by
  // provider hints (email domain or URL keyword) so the user can pick an
  // existing account instead of retyping it.
  useEffect(() => {
    if (kind !== "login" || login.method === "credentials") {
      setAccountSuggestions([]);
      return;
    }
    let cancelled = false;
    api
      .listItems(undefined, "login")
      .then((all) => {
        if (cancelled) return;
        // Accounts may be stored as "credentials" (legacy) or as the provider
        // method itself (e.g. added via "+ Add new account"); both match.
        const matches = all.filter(
          (it) =>
            it.username &&
            accountMatchesProvider(it.username, login.method),
        );
        // De-dupe by account identifier (same email across many sites)
        const seen = new Set<string>();
        const unique = matches.filter((it) => {
          const key = (it.username || "").toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setAccountSuggestions(unique);
      })
      .catch(() => {
        if (!cancelled) setAccountSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, login.method]);

  async function copy(label: string, text: string) {
    if (!text) return;
    try {
      await api.copyToClipboard(text, 30);
      setCopied(label);
      window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1400);
    } catch {
      // ignore
    }
  }

  async function handleUrlBlur() {
    let url = login.url.trim();
    if (!url || !isValidUrl(url) || fetchingMeta) return;

    // Strip path/query: store bare host origin (https://www.twitch.tv).
    try {
      const u = new URL(url);
      const cleaned = `${u.protocol}//${u.host}`;
      if (cleaned !== url) {
        url = cleaned;
        setLogin((prev) => ({ ...prev, url: url }));
      }
    } catch {
      // not a parseable URL — leave as typed
    }

    setFetchingMeta(true);
    try {
      const meta = await api.fetchUrlMetadata(url);
      if (meta.favicon_data_url) {
        setFavicon(meta.favicon_data_url);
      }
      if (meta.title && !title.trim()) {
        setTitle(meta.title);
      }
    } catch {
      // Fetch failed, no metadata. Silent ignore.
    } finally {
      setFetchingMeta(false);
    }
  }

  async function save() {
    const errors: Record<string, string> = {};
    if (!title.trim()) {
      errors.title = "Title is required.";
    }
    if (kind === "login" && !isValidUrl(login.url)) {
      errors.url = "URL must be a valid http(s) link (e.g. https://example.com).";
    }
    if (kind === "card") {
      const exp = card.exp.trim();
      if (!exp) {
        errors.exp = "Card expiration is required.";
      } else if (!isValidExp(exp)) {
        errors.exp = "Card expiration must be MM/YY.";
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const now = Date.now();
      const itemId = id ?? crypto.randomUUID();
      let item: Item;
      const base = {
        id: itemId,
        title: title.trim(),
        notes,
        created_at: 0,
        updated_at: now,
        favicon: favicon ?? "",
      };
      if (kind === "login") {
        item = { type: "login", ...base, ...login };
      } else if (kind === "note") {
        item = { type: "note", ...base, ...note };
      } else {
        item = { type: "card", ...base, ...card };
      }
      await api.saveItem(item);
      onSaved?.();
      onClose();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="toolbar">
        <div>
          <p className="screen-eyebrow">Item · {id === null ? "New" : "Edit"}</p>
          <h2>{title.trim() || (id === null ? "New item" : "Untitled")}</h2>
        </div>
        <div className="actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            <XIcon /> Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="kind-tabs" aria-label="Item kind">
        {(["login", "note", "card"] as ItemKind[]).map((k) => (
          <button
            key={k}
            type="button"
            className={kind === k ? "active" : ""}
            onClick={() => setKind(k)}
          >
            {k}
          </button>
        ))}
      </div>

      <div className="fields">
        <div className="field">
          <p className="field-label">Title</p>
          <div className="field-row">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Title"
              autoFocus={id === null}
            />
          </div>
          {fieldErrors.title && <p className="field-error" role="alert">{fieldErrors.title}</p>}
        </div>

        {kind === "login" && (
          <>
            <div className="field">
              <p className="field-label">Login method</p>
              <div className="method-grid" role="radiogroup" aria-label="Login method">
                {methods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={login.method === m.id}
                    className={`method-option ${login.method === m.id ? "active" : ""}`}
                    onClick={() => setLogin({ ...login, method: m.id })}
                  >
                    <MethodChip method={m.id} size={20} />
                    <span>{m.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <p className="field-label">URL</p>
              <div className="field-row">
                {favicon && (
                  <img
                    src={favicon}
                    alt=""
                    style={{ width: 16, height: 16, marginRight: 8 }}
                  />
                )}
                <input
                  value={login.url}
                  onChange={(e) => setLogin({ ...login, url: e.target.value })}
                  onBlur={handleUrlBlur}
                  aria-label="URL"
                  spellCheck={false}
                  autoComplete="off"
                  inputMode="url"
                  placeholder="https://example.com"
                />
              </div>
              {fieldErrors.url && <p className="field-error" role="alert">{fieldErrors.url}</p>}
            </div>
            {login.method !== "credentials" && (
              <div className="field">
                <p className="field-label">Account</p>
                {accountSuggestions.length > 0 ? (
                  <div className="chips">
                    {accountSuggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className={`chip-btn ${login.username === s.username ? "active" : ""}`}
                        onClick={() => setLogin({ ...login, username: s.username || "" })}
                      >
                        <span>{s.username}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted">No {methodLabel(login.method)} account in your vault yet.</p>
                )}
                <button
                  type="button"
                  className="add-account-link"
                  onClick={() => setCreatingAccount(true)}
                >
                  + Add new account
                </button>
              </div>
            )}
            {login.method === "credentials" && (
              <div className="field">
                <p className="field-label">Username</p>
                <div className="field-row">
                  <input
                    value={login.username}
                    onChange={(e) => setLogin({ ...login, username: e.target.value })}
                    aria-label="Username"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
                {!login.username && (
                  <PersonalChips personal={personalInfo} onPick={(u) => setLogin({ ...login, username: u })} />
                )}
              </div>
            )}
            <div className="field">
              <p className="field-label">Password</p>
              <div className="copy-row">
                <div className="field-row">
                  <input
                    className="mono"
                    type={showPassword ? "text" : "password"}
                    value={login.password}
                    onChange={(e) => setLogin({ ...login, password: e.target.value })}
                    aria-label="Password"
                    spellCheck={false}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="reveal"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                  </button>
                </div>
                <button
                  type="button"
                  className={`copy-inline ${copied === "password" ? "copied" : ""}`}
                  onClick={() => copy("password", login.password)}
                  disabled={!login.password}
                >
                  {copied === "password" ? <CheckIcon /> : <CopyIcon />}
                  {copied === "password" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </>
        )}

        {kind === "note" && (
          <div className="field">
            <p className="field-label">Body</p>
            <div className="field-row">
              <textarea
                rows={8}
                value={note.body}
                onChange={(e) => setNote({ body: e.target.value })}
                aria-label="Note body"
                spellCheck={false}
              />
            </div>
          </div>
        )}

        {kind === "card" && (
          <>
            <div className="field">
              <p className="field-label">Cardholder</p>
              <div className="field-row">
                <input
                  value={card.cardholder}
                  onChange={(e) => setCard({ ...card, cardholder: e.target.value })}
                  aria-label="Cardholder"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="field">
              <p className="field-label">Number</p>
              <div className="copy-row">
                <div className="field-row">
                  <input
                    className="mono"
                    type="text"
                    value={card.number}
                    onChange={(e) => {
                      const formatted = formatCardNumber(e.target.value);
                      setCard({ ...card, number: formatted });
                    }}
                    aria-label="Card number"
                    spellCheck={false}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="1234-5678-9012-3456"
                    maxLength={19}
                  />
                </div>
                <button
                  type="button"
                  className={`copy-inline ${copied === "number" ? "copied" : ""}`}
                  onClick={() => copy("number", card.number)}
                  disabled={!card.number}
                >
                  {copied === "number" ? <CheckIcon /> : <CopyIcon />}
                  {copied === "number" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
            <div className="field">
              <p className="field-label">Exp</p>
              <div className="field-row">
                <input
                  className="mono"
                  value={card.exp}
                  onChange={(e) => {
                    const formatted = formatCardExp(e.target.value);
                    setCard({ ...card, exp: formatted });
                  }}
                  aria-label="Card expiration"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="MM/YY"
                  maxLength={5}
                />
              </div>
              {fieldErrors.exp && <p className="field-error" role="alert">{fieldErrors.exp}</p>}
            </div>
            <div className="field">
              <p className="field-label">CVV</p>
              <div className="copy-row">
                <div className="field-row">
                  <input
                    className="mono"
                    type="password"
                    value={card.cvv}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
                      setCard({ ...card, cvv: digits });
                    }}
                    aria-label="CVV"
                    spellCheck={false}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={4}
                  />
                </div>
                <button
                  type="button"
                  className={`copy-inline ${copied === "cvv" ? "copied" : ""}`}
                  onClick={() => copy("cvv", card.cvv)}
                  disabled={!card.cvv}
                >
                  {copied === "cvv" ? <CheckIcon /> : <CopyIcon />}
                  {copied === "cvv" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          </>
        )}

        <div className="field">
          <p className="field-label">Notes</p>
          <div className="field-row">
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              aria-label="Notes"
              spellCheck={false}
            />
          </div>
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
    </form>
    {creatingAccount && login.method !== "credentials" && (
      <NewAccountModal
        providerMethod={login.method}
        onClose={() => setCreatingAccount(false)}
        onCreated={({ username: u }) => {
          setLogin((prev) => ({ ...prev, username: u }));
          setCreatingAccount(false);
          // Bump the suggestion list so the new account appears immediately.
          setAccountSuggestions((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              kind: "login",
              title: u,
              updated_at: Date.now(),
              favicon: "",
              method: login.method,
              username: u,
            },
          ]);
        }}
      />
    )}
    </>
  );
}

/**
 * Quick-fill chips sourced from the global personal profile: email, phone,
 * and username. Shown when the identifier field is empty.
 */
function PersonalChips({
  personal,
  onPick,
}: {
  personal: Pick<PersonalInfo, "email" | "phone" | "username">;
  onPick: (value: string) => void;
}) {
  const values = [
    { label: "Email", value: personal.email },
    { label: "Phone", value: personal.phone },
    { label: "Username", value: personal.username },
  ].filter((v) => v.value.trim());
  if (values.length === 0) return null;
  return (
    <div className="suggestions">
      <p className="suggestions-label">Personal profile</p>
      <div className="chips">
        {values.map((v) => (
          <button
            key={v.label}
            type="button"
            className="chip-btn"
            onClick={() => onPick(v.value)}
          >
            {v.label}: <span>{v.value}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Inline sub-flow to add a brand-new credential login (e.g. a Gmail account)
 * to the vault without leaving the parent ItemEditor. After saving, the
 * parent picks up the new account via onCreated.
 */
function NewAccountModal({
  providerMethod,
  onClose,
  onCreated,
}: {
  providerMethod: Exclude<LoginMethod, "credentials">;
  onClose: () => void;
  onCreated: (account: { id: string; username: string }) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const providerLabel = methods.find((m) => m.id === providerMethod)?.label ?? providerMethod;

  async function save() {
    const errors: Record<string, string> = {};
    if (!username.trim()) errors.account = "Account is required.";
    if (!password) errors.password = "Password is required.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const item: Item = {
        type: "login",
        id: crypto.randomUUID(),
        title: username.trim(),
        notes: "",
        created_at: 0,
        updated_at: Date.now(),
        favicon: "",
        method: providerMethod,
        url: "",
        username: username.trim(),
        password,
      };
      await api.saveItem(item);
      onCreated({ id: item.id, username: item.username });
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-label={`Add ${providerLabel} account`}>
      <form
        className="editor sub-modal"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="toolbar">
          <div className="method-static">
            <MethodChip method={providerMethod} size={22} />
            <div>
              <p className="screen-eyebrow">New account</p>
              <h2>Add {providerLabel} account</h2>
            </div>
          </div>
          <div className="actions">
            <button type="button" className="btn-ghost" onClick={onClose}>
              <XIcon /> Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !username.trim() || !password}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        <div className="fields">
          <div className="field">
            <p className="field-label">Account</p>
            <div className="field-row">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                aria-label="Account"
                autoFocus
                spellCheck={false}
                autoComplete="off"
                placeholder="you@example.com"
              />
            </div>
            {fieldErrors.account && <p className="field-error" role="alert">{fieldErrors.account}</p>}
          </div>
          <div className="field">
            <p className="field-label">Password</p>
            <div className="field-row">
              <input
                className="mono"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="Password"
                spellCheck={false}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="reveal"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                title={showPassword ? "Hide" : "Show"}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            {fieldErrors.password && <p className="field-error" role="alert">{fieldErrors.password}</p>}
          </div>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </div>
  );
}
