import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { PersonalInfo } from "../lib/types";
import type { Item, ItemKind, ItemMeta, LoginFields, LoginMethod, NoteFields, CardFields } from "../lib/types";
import { CopyIcon, CheckIcon, EyeIcon, EyeOffIcon, XIcon, ShieldIcon, KeyIcon, CardIcon, NoteIcon } from "../components/Icon";
import {
  methods,
  MethodChip,
  accountMatchesProvider,
  methodLabel,
  providerAccount,
  normalizeAccount,
} from "../lib/methods";
import { useHotkey } from "../lib/useHotkey";
import PhoneField from "../components/PhoneField";
import { isValidPhone } from "../lib/phone";
import Generator from "../components/Generator";
import NoteEditor from "../components/NoteEditor";
import { logUi } from "../lib/log";

interface Props {
  id: string | null;
  initialKind?: ItemKind;
  /** Set when the kind came from an active section filter, not a free choice. */
  lockKind?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

const emptyLogin = (): LoginFields => ({
  method: "credentials",
  url: "",
  username: "",
  password: "",
  phone: "",
  totp: "",
});
const emptyNote = (): NoteFields => ({ body: "" });
const emptyCard = (): CardFields => ({ cardholder: "", number: "", exp: "", cvv: "" });

function isValidUrl(s: string): boolean {
  if (!s.trim()) return true;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidExp(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  return /^\d{2}\/\d{2}$/.test(t);
}

// MM must be 01-12 and the card must not already be expired. Cards stay valid
// through the last day of their printed month.
function isExpiredOrBadMonth(exp: string, now = new Date()): "month" | "expired" | null {
  const [mm, yy] = exp.trim().split("/").map(Number);
  if (mm < 1 || mm > 12) return "month";
  const expiresEnd = new Date(2000 + yy, mm, 1);
  return expiresEnd <= now ? "expired" : null;
}

// Luhn checksum — catches typo'd digits in a card number.
function isValidCardNumber(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// Embossed names are letters and a few separators, capped at the 26 chars
// the card itself allows.
function sanitizeCardholder(raw: string): string {
  return raw.replace(/[^A-Za-z\u00C0-\u024F .'-]/g, "").slice(0, 26);
}

// ISO/IEC 7812 allows up to 19 digits (UnionPay, some Discover and Maestro
// cards use them); capping at 16 silently truncated those and then failed
// them on Luhn.
function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 19);
  const parts = [];
  for (let i = 0; i < digits.length; i += 4) {
    parts.push(digits.slice(i, i + 4));
  }
  return parts.join("-");
}

function formatCardExp(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length >= 3) {
    return digits.slice(0, 2) + "/" + digits.slice(2, 4);
  }
  return digits;
}

const SECTION_ICON: Record<ItemKind, typeof ShieldIcon> = {
  login: ShieldIcon,
  note: NoteIcon,
  card: CardIcon,
};

function Section({ title, icon: Icon, children }: { title: string; icon: typeof ShieldIcon; children: React.ReactNode }) {
  return (
    <div className="card flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2 text-on-surface">
        <Icon size={16} />
        <h3 className="text-body-md font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function ItemEditor({ id, initialKind, lockKind, onClose, onSaved }: Props) {
  // An existing item's kind is fixed: switching it would silently drop the
  // fields that only that kind has. Only a brand-new item is free to change.
  const kindLocked = lockKind || id !== null;
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
  const [dirty, setDirty] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  // Signing in through Google/GitHub/an app usually means there is no
  // password to store — but plenty of accounts have both (an app login and a
  // password set on the same account), so it stays one click away.
  const [wantsPassword, setWantsPassword] = useState(false);
  const passwordShown = login.method === "credentials" || wantsPassword || login.password !== "";

  const [favicon, setFavicon] = useState<string | null>(null);
  const [fetchingMeta, setFetchingMeta] = useState(false);

  const [accountSuggestions, setAccountSuggestions] = useState<ItemMeta[]>([]);
  const [creatingAccount, setCreatingAccount] = useState(false);

  const [personalInfo, setPersonalInfo] = useState<{ email: string; phone: string; username: string }>({
    email: "",
    phone: "",
    username: "",
  });

  // Marks the form dirty on any field edit so Esc knows whether it's safe to
  // discard. Loading an existing item (below) resets this flag afterward.
  function markDirty() {
    setDirty(true);
  }

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
    api
      .getItem(id)
      .then((item) => {
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
            phone: item.phone || "",
            totp: item.totp || "",
          });
        } else if (item.type === "note") {
          setNote({ body: item.body });
        } else {
          setCard({ cardholder: item.cardholder, number: item.number, exp: item.exp, cvv: item.cvv });
        }
        setDirty(false);
      })
      .catch((err) => {
        setError(`Failed to load item: ${err}`);
      });
  }, [id]);

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
        const matches = all.filter(
          (it) => it.id !== id && it.username && accountMatchesProvider(it.username, login.method),
        );
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

    try {
      const u = new URL(url);
      const cleaned = `${u.protocol}//${u.host}`;
      if (cleaned !== url) {
        url = cleaned;
        setLogin((prev) => ({ ...prev, url }));
      }
    } catch {
      // not a parseable URL — leave as typed
    }

    setFetchingMeta(true);
    try {
      const meta = await api.fetchUrlMetadata(url);
      if (meta.favicon_data_url) setFavicon(meta.favicon_data_url);
      if (meta.title && !title.trim()) setTitle(meta.title);
    } catch {
      // Fetch failed, no metadata. Silent ignore.
    } finally {
      setFetchingMeta(false);
    }
  }

  async function save() {
    const errors: Record<string, string> = {};
    if (!title.trim()) errors.title = "Title is required.";
    if (kind === "login") {
      if (!isValidUrl(login.url)) {
        errors.url = "URL must be a valid http(s) link (e.g. https://example.com).";
      }
      if (login.phone && !isValidPhone(login.phone)) {
        errors.phone = "Not a valid phone number.";
      }
      if (login.method === "credentials" && !login.password) {
        errors.password = "Password is required.";
      }
    }
    if (kind === "note" && !note.body.trim()) {
      errors.body = "Note body is required.";
    }
    if (kind === "card") {
      const exp = card.exp.trim();
      if (!exp) errors.exp = "Card expiration is required.";
      else if (!isValidExp(exp)) errors.exp = "Card expiration must be MM/YY.";
      else {
        const problem = isExpiredOrBadMonth(exp);
        if (problem === "month") errors.exp = "Month must be between 01 and 12.";
        else if (problem === "expired") errors.exp = "This card has expired.";
      }
      const number = card.number.trim();
      if (!number) errors.number = "Card number is required.";
      else if (!isValidCardNumber(number)) {
        errors.number = "Card number looks wrong — check the digits.";
      }
      const cvv = card.cvv.trim();
      if (cvv && cvv.length < 3) errors.cvv = "CVV is 3 or 4 digits.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      logUi("warn", "item-editor", `save blocked kind=${kind} fields=${Object.keys(errors).join(",")}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const now = Date.now();
      const itemId = id ?? crypto.randomUUID();
      let item: Item;
      const base = { id: itemId, title: title.trim(), notes, created_at: 0, updated_at: now, favicon: favicon ?? "" };
      if (kind === "login") item = { type: "login", ...base, ...login };
      else if (kind === "note") item = { type: "note", ...base, ...note };
      else item = { type: "card", ...base, ...card };
      await api.saveItem(item);
      logUi(
        "info",
        "item-editor",
        `saved ${id ? "existing" : "new"} kind=${kind}` +
          (kind === "login" ? ` method=${login.method} hasPassword=${login.password !== ""}` : ""),
      );
      onSaved?.();
      onClose();
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  useHotkey("ctrl+s", save);
  // Esc cancels only when nothing has been edited — prevents losing typed
  // data on an accidental keypress. When dirty, Esc is a no-op; the user
  // must use Cancel/Save explicitly.
  useHotkey("escape", onClose, !dirty && !creatingAccount);

  const SectionIcon = SECTION_ICON[kind];

  return (
    <>
      <form
        className="dialog flex max-h-[90vh] w-full max-w-[640px] flex-col gap-4 overflow-y-auto"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-white/6 bg-surface-container/95 px-6 py-4 backdrop-blur">
          <h2 className="truncate text-headline-sm text-on-surface">
            {title.trim() || (id === null ? "New item" : "Untitled")}
          </h2>
          <div className="flex flex-shrink-0 gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>
              <XIcon size={14} /> Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4 px-6 pb-6">
          <Section title="Item" icon={SectionIcon}>
            {kindLocked ? (
              <span className="self-start rounded-control bg-primary px-3 py-1.5 text-body-sm font-medium capitalize text-on-primary">
                {kind}
              </span>
            ) : (
              <div className="flex gap-2" role="group" aria-label="Item kind">
                {(["login", "note", "card"] as ItemKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setKind(k);
                      markDirty();
                    }}
                    className={`rounded-control px-3 py-1.5 text-body-sm font-medium capitalize transition-colors duration-150 ease-out ${
                      kind === k ? "bg-primary text-on-primary" : "text-on-surface-variant hover:bg-white/4"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <p className="label-md">Title</p>
              <input
                value={title}
                maxLength={80}
                onChange={(e) => {
                  setTitle(e.target.value);
                  markDirty();
                }}
                aria-label="Title"
                autoFocus={id === null}
                className="field"
              />
              {fieldErrors.title && (
                <p role="alert" className="text-body-sm text-error">
                  {fieldErrors.title}
                </p>
              )}
            </div>
            {kind === "login" && (
              <div className="flex flex-col gap-1.5">
                <p className="label-md">URL</p>
                <div className="relative">
                  {favicon && (
                    <img src={favicon} alt="" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                  )}
                  <input
                    value={login.url}
                    onChange={(e) => {
                      setLogin({ ...login, url: e.target.value });
                      markDirty();
                    }}
                    onBlur={handleUrlBlur}
                    aria-label="URL"
                    spellCheck={false}
                    autoComplete="off"
                    inputMode="url"
                    placeholder="https://example.com"
                    className={`field ${favicon ? "pl-9" : ""}`}
                  />
                </div>
                {fieldErrors.url && (
                  <p role="alert" className="text-body-sm text-error">
                    {fieldErrors.url}
                  </p>
                )}
              </div>
            )}
          </Section>

          {kind === "login" && (
            <Section title="Sign-in" icon={ShieldIcon}>
              <div className="flex flex-col gap-1.5">
                <p className="label-md">Login method</p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2" role="radiogroup" aria-label="Login method">
                  {methods.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={login.method === m.id}
                      aria-label={m.label}
                      onClick={() => {
                        setLogin({ ...login, method: m.id });
                        markDirty();
                      }}
                      className={`flex items-center gap-2.5 rounded-control border px-3 py-2 text-body-md transition-colors duration-150 ease-out ${
                        login.method === m.id
                          ? "border-primary-container bg-primary/8 text-on-surface"
                          : "border-white/8 bg-surface-container-low text-on-surface-variant hover:bg-white/4"
                      }`}
                    >
                      <MethodChip method={m.id} size={20} />
                      <span>{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              {login.method !== "credentials" ? (
                <div className="flex flex-col gap-1.5">
                  <p className="label-md">{login.method === "other" ? "Sign in with" : "Account"}</p>
                  {accountSuggestions.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {accountSuggestions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setLogin({ ...login, username: s.username || "" });
                            markDirty();
                          }}
                          className={`flex max-w-full items-center gap-2 rounded-chip border px-2.5 py-1 text-body-sm transition-colors duration-150 ease-out ${
                            login.username === s.username
                              ? "border-primary bg-primary text-on-primary"
                              : "border-white/8 bg-surface-container-low text-on-surface hover:bg-white/4"
                          }`}
                        >
                          {login.method === "other" && <span className="truncate font-medium">{s.title}</span>}
                          <span className="truncate font-mono">{s.username}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-body-sm text-on-surface-variant">
                      {login.method === "other"
                        ? "No other login in your vault to sign in with yet."
                        : `No ${methodLabel(login.method)} account in your vault yet.`}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setCreatingAccount(true)}
                    className="self-start text-body-sm font-medium text-primary hover:underline"
                  >
                    + Add new account
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <p className="label-md">Username</p>
                  <input
                    value={login.username}
                    onChange={(e) => {
                      setLogin({ ...login, username: normalizeAccount(e.target.value) });
                      markDirty();
                    }}
                    aria-label="Username"
                    spellCheck={false}
                    autoComplete="off"
                    className="field"
                  />
                  {!login.username && (
                    <PersonalChips
                      personal={personalInfo}
                      onPick={(u) => {
                        setLogin({ ...login, username: u });
                        markDirty();
                      }}
                    />
                  )}

                  {/* Some sites sign you in by phone and never ask for a
                      username at all. Stored with its dial code so the
                      filler can split it back out for a form that has a
                      separate country picker. */}
                  <p className="label-md mt-1.5">Phone number</p>
                  <PhoneField
                    value={login.phone}
                    onChange={(phone) => {
                      setLogin({ ...login, phone });
                      markDirty();
                    }}
                    ariaLabel="Phone number"
                    logScope="item-editor"
                  />
                  {fieldErrors.phone && (
                    <p role="alert" className="text-body-sm text-error">
                      {fieldErrors.phone}
                    </p>
                  )}
                  {!login.phone && personalInfo.phone && (
                    <button
                      type="button"
                      onClick={() => {
                        setLogin({ ...login, phone: personalInfo.phone });
                        markDirty();
                      }}
                      className="self-start text-body-sm font-medium text-primary hover:underline"
                    >
                      Use {personalInfo.phone}
                    </button>
                  )}
                </div>
              )}
            </Section>
          )}

          {kind === "login" && !passwordShown && (
            <Section title="Password" icon={KeyIcon}>
              <p className="text-body-sm text-on-surface-variant">
                You sign in with {methodLabel(login.method)}, so there is no password to keep here.
              </p>
              <button
                type="button"
                className="btn-secondary self-start"
                onClick={() => {
                  setWantsPassword(true);
                  logUi("info", "item-editor", `password field revealed method=${login.method}`);
                }}
              >
                <KeyIcon size={14} /> Still have a password?
              </button>
            </Section>
          )}

          {kind === "login" && passwordShown && (
            <Section title="Password" icon={KeyIcon}>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={login.password}
                    onChange={(e) => {
                      setLogin({ ...login, password: e.target.value });
                      markDirty();
                    }}
                    aria-label="Password"
                    spellCheck={false}
                    autoComplete="new-password"
                    className="field w-full pr-10 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    title={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-outline transition-colors duration-150 ease-out hover:text-on-surface"
                  >
                    {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => copy("password", login.password)}
                  disabled={!login.password}
                  className={`btn-secondary ${copied === "password" ? "!border-secondary !text-secondary" : ""}`}
                >
                  {copied === "password" ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                  {copied === "password" ? "Copied" : "Copy"}
                </button>
                <button type="button" onClick={() => setShowGenerator(true)} className="btn-secondary">
                  <KeyIcon size={14} /> Generate
                </button>
              </div>
              {fieldErrors.password && (
                <p role="alert" className="text-body-sm text-error">
                  {fieldErrors.password}
                </p>
              )}
              {login.method !== "credentials" && (
                <button
                  type="button"
                  onClick={() => {
                    setLogin({ ...login, password: "" });
                    setWantsPassword(false);
                    markDirty();
                  }}
                  className="self-start text-body-sm font-medium text-on-surface-variant hover:text-error"
                >
                  No password on this account
                </button>
              )}
            </Section>
          )}

          {kind === "login" && (
            <Section title="Two-factor codes" icon={ShieldIcon}>
              <p className="text-body-sm text-on-surface-variant">
                When a site turns on an authenticator app, it shows a QR code. Screenshot it
                (Win+Shift+S) and paste it here, or type the key it offers under "can't scan it?".
              </p>
              <div className="flex items-center gap-2">
                <input
                  value={login.totp}
                  onChange={(e) => {
                    setLogin({ ...login, totp: e.target.value });
                    markDirty();
                  }}
                  aria-label="2FA key"
                  placeholder="2FA key"
                  spellCheck={false}
                  autoComplete="off"
                  className="field flex-1 font-mono"
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={async () => {
                    setFieldErrors(({ totp: _, ...rest }) => rest);
                    try {
                      const link = await api.totpFromClipboard();
                      setLogin({ ...login, totp: link });
                      markDirty();
                      logUi("info", "item-editor", "2FA key read from a QR code");
                    } catch (e) {
                      setFieldErrors((f) => ({ ...f, totp: String(e) }));
                    }
                  }}
                >
                  Paste QR code
                </button>
              </div>
              {fieldErrors.totp && (
                <p role="alert" className="text-body-sm text-error">
                  {fieldErrors.totp}
                </p>
              )}
            </Section>
          )}

          {showGenerator && (
            <Generator
              onClose={() => setShowGenerator(false)}
              onUse={(pw) => {
                setLogin({ ...login, password: pw });
                markDirty();
                setShowGenerator(false);
              }}
            />
          )}

          {kind === "note" && (
            <Section title="Note body" icon={NoteIcon}>
              <NoteEditor
                label="Note body"
                value={note.body}
                onChange={(body) => {
                  setNote({ body });
                  markDirty();
                }}
              />
              {fieldErrors.body && (
                <p role="alert" className="text-body-sm text-error">
                  {fieldErrors.body}
                </p>
              )}
            </Section>
          )}

          {kind === "card" && (
            <Section title="Card details" icon={CardIcon}>
              <div className="flex flex-col gap-1.5">
                <p className="label-md">Cardholder</p>
                <input
                  value={card.cardholder}
                  onChange={(e) => {
                    setCard({ ...card, cardholder: sanitizeCardholder(e.target.value) });
                    markDirty();
                  }}
                  aria-label="Cardholder"
                  spellCheck={false}
                  autoComplete="off"
                  className="field"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="label-md">Number</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={card.number}
                    onChange={(e) => {
                      setCard({ ...card, number: formatCardNumber(e.target.value) });
                      markDirty();
                    }}
                    aria-label="Card number"
                    spellCheck={false}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="1234-5678-9012-3456"
                    maxLength={23}
                    className="field flex-1 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => copy("number", card.number)}
                    disabled={!card.number}
                    className={`btn-secondary ${copied === "number" ? "!border-secondary !text-secondary" : ""}`}
                  >
                    {copied === "number" ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                    {copied === "number" ? "Copied" : "Copy"}
                  </button>
                </div>
                {fieldErrors.number && (
                  <p role="alert" className="text-body-sm text-error">
                    {fieldErrors.number}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="label-md">Exp</p>
                <input
                  value={card.exp}
                  onChange={(e) => {
                    setCard({ ...card, exp: formatCardExp(e.target.value) });
                    markDirty();
                  }}
                  aria-label="Card expiration"
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="MM/YY"
                  maxLength={5}
                  className="field font-mono"
                />
                {fieldErrors.exp && (
                  <p role="alert" className="text-body-sm text-error">
                    {fieldErrors.exp}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <p className="label-md">CVV</p>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={card.cvv}
                    onChange={(e) => {
                      setCard({ ...card, cvv: e.target.value.replace(/\D/g, "").slice(0, 4) });
                      markDirty();
                    }}
                    aria-label="CVV"
                    spellCheck={false}
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={4}
                    className="field flex-1 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => copy("cvv", card.cvv)}
                    disabled={!card.cvv}
                    className={`btn-secondary ${copied === "cvv" ? "!border-secondary !text-secondary" : ""}`}
                  >
                    {copied === "cvv" ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                    {copied === "cvv" ? "Copied" : "Copy"}
                  </button>
                </div>
                {fieldErrors.cvv && (
                  <p role="alert" className="text-body-sm text-error">
                    {fieldErrors.cvv}
                  </p>
                )}
              </div>
            </Section>
          )}

          {/* Stored as `notes` in the vault — renaming the field would mean a
              migration for a label. "Comments" is what it has always been:
              a remark about the item, not the item's own body. */}
          <Section title="Comments" icon={NoteIcon}>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                markDirty();
              }}
              aria-label="Comments"
              placeholder="Anything worth remembering about this item"
              spellCheck
              className="field h-auto resize-y py-2.5"
            />
          </Section>

          {error && (
            <p role="alert" className="text-body-sm text-error">
              {error}
            </p>
          )}
        </div>
      </form>
      {creatingAccount && login.method !== "credentials" && (
        <NewAccountModal
          providerMethod={login.method}
          onClose={() => setCreatingAccount(false)}
          onCreated={({ username: u }) => {
            setLogin((prev) => ({ ...prev, username: u }));
            setCreatingAccount(false);
            markDirty();
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
                card_bin: null,
                host: null,
                pinned: false,
                icon_checked_at: 0,
              },
            ]);
          }}
        />
      )}
    </>
  );
}

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
    <div className="flex flex-col gap-1.5">
      <p className="label-sm">Personal profile</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <button
            key={v.label}
            type="button"
            onClick={() => onPick(v.value)}
            className="rounded-chip border border-white/8 bg-surface-container-low px-2.5 py-1 font-mono text-body-sm text-on-surface transition-colors duration-150 ease-out hover:bg-white/4"
          >
            {v.label}: {v.value}
          </button>
        ))}
      </div>
    </div>
  );
}

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
  // "Google" is the button you press; Gmail is the account you actually own,
  // so that is what the saved item is called and linked to.
  const account = providerAccount(providerMethod);

  useHotkey("escape", onClose);

  async function save() {
    const errors: Record<string, string> = {};
    if (!username.trim()) errors.account = "Account is required.";
    else if (/\s/.test(username.trim())) errors.account = "Account cannot contain spaces.";
    if (!password) errors.password = "Password is required.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const url = account?.url ?? "";
      // Pull the real logo (Gmail's envelope, not Google's G) so the platform
      // card in the vault shows what the user recognises.
      let favicon = "";
      if (url) {
        try {
          const meta = await api.fetchUrlMetadata(url);
          favicon = meta.favicon_data_url ?? "";
        } catch {
          // offline or blocked — the provider chip is the fallback
        }
      }
      const item: Item = {
        type: "login",
        id: crypto.randomUUID(),
        title: account?.label ?? username.trim(),
        notes: "",
        created_at: 0,
        updated_at: Date.now(),
        favicon,
        method: providerMethod,
        url,
        username: normalizeAccount(username.trim()),
        password,
        phone: "",
        totp: "",
      };
      await api.saveItem(item);
      logUi("info", "new-account", `created provider=${providerMethod}`);
      onCreated({ id: item.id, username: item.username });
    } catch (e: any) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label={`Add ${providerLabel} account`}
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-5"
    >
      <form
        className="dialog flex w-full max-w-[420px] flex-col gap-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <MethodChip method={providerMethod} size={22} />
            <div>
              <p className="label-sm">New account</p>
              <h2 className="text-headline-sm text-on-surface">
                Add {account?.label ?? providerLabel} account
              </h2>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <p className="label-md">Account</p>
            <input
              value={username}
              onChange={(e) => setUsername(normalizeAccount(e.target.value))}
              aria-label="Account"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              placeholder="you@example.com"
              className="field"
            />
            {fieldErrors.account && (
              <p role="alert" className="text-body-sm text-error">
                {fieldErrors.account}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="label-md">Password</p>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus={false}
                aria-label="Password"
                spellCheck={false}
                autoComplete="new-password"
                className="field pr-10 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                title={showPassword ? "Hide" : "Show"}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-outline transition-colors duration-150 ease-out hover:text-on-surface"
              >
                {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
              </button>
            </div>
            {fieldErrors.password && (
              <p role="alert" className="text-body-sm text-error">
                {fieldErrors.password}
              </p>
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="text-body-sm text-error">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            <XIcon size={14} /> Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !username.trim() || !password}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
