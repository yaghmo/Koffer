export type ItemKind = "login" | "note" | "card";

export interface ItemBase {
  id: string;
  title: string;
  notes: string;
  created_at: number;
  updated_at: number;
  favicon: string;
}

export type LoginMethod = "credentials" | "google" | "github" | "microsoft" | "apple" | "facebook" | "other";

export interface LoginFields {
  method: LoginMethod;
  url: string;
  username: string;
  password: string;
  /** "+1 555-123-4567", for sites that sign you in by phone. May be empty. */
  phone: string;
  /** 2FA key: an `otpauth://totp/...` link or a base32 key. May be empty. */
  totp: string;
  /** Replaced passwords, newest first. Sent by the app; the editor leaves it alone. */
  previous_passwords?: PreviousPassword[];
  /** The password a browser login last worked with, when it differs. */
  last_seen?: LastSeen | null;
}

export interface PreviousPassword {
  password: string;
  replaced_at: number;
}

export interface LastSeen {
  password: string;
  seen_at: number;
}

/** One authenticator code, and how long until the next. */
export interface TotpCode {
  code: string;
  seconds_left: number;
}

export interface NoteFields {
  body: string;
}

export interface CardFields {
  cardholder: string;
  number: string;
  exp: string;
  cvv: string;
}

export type Item =
  | ({ type: "login" } & ItemBase & LoginFields)
  | ({ type: "note" } & ItemBase & NoteFields)
  | ({ type: "card" } & ItemBase & CardFields);

export interface ItemMeta {
  id: string;
  kind: ItemKind;
  title: string;
  updated_at: number;
  favicon: string;
  method: LoginMethod | null;
  username: string | null;
  card_bin: string | null;
  /** Bare domain of a login's URL, e.g. "twitch.tv". Null for notes/cards. */
  host: string | null;
  pinned: boolean;
  /** Unix seconds of the last favicon check; 0 when never checked. */
  icon_checked_at: number;
}

/** Mirrors the per-kind caps enforced in vault.rs. */
export const PIN_LIMITS: Record<ItemKind, number> = { login: 10, note: 5, card: 5 };

export interface GenOpts {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
}

export interface Config {
  autolock_mins: number;
  /**
   * Whether unlocking re-checks stale login logos on its own. Off by default:
   * the refresh contacts every site with a stale icon, putting the vault's
   * account list into DNS and TLS SNI at each unlock.
   */
  auto_refresh_icons: boolean;
}

export interface SecurityState {
  has_recovery: boolean;
  /** Unix seconds of the last export; 0 when never exported. */
  last_export_secs: number;
}

export interface VaultStorage {
  path: string;
  bytes: number;
  modified_secs: number;
}

/** A browser extension paired with this vault. Never carries its token. */
export interface PairedInfo {
  /** `chrome-extension://<id>` — the only origin its token is honoured from. */
  origin: string;
  label: string;
  paired_at: number;
  /** Sites this browser may be handed a password for, as approved one at a
   *  time. Empty on a fresh pairing: pairing grants the ability to ask. */
  allowed_hosts: string[];
}

export interface BridgeState {
  /** Empty when the listener came up; why it did not, otherwise. */
  listen_error: string;
  port: number;
  clients: PairedInfo[];
}

export interface BackupState {
  configured: boolean;
  url: string;
  /** Unix seconds of the last successful upload; 0 when never uploaded. */
  last_backup_secs: number;
  /** The last upload attempt's failure message; empty when it succeeded or
   * none has run yet. Reflects the *last* attempt, not necessarily the
   * vault's current backup status. */
  last_backup_error: string;
}

export interface PersonalInfo {
  name: string;
  username: string;
  email: string;
  phone: string;
  website: string;
  github: string;
  linkedin: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  date_of_birth: string;
  current_title: string;
  current_company: string;
  years_experience: string;
  school: string;
  degree: string;
  desired_salary: string;
}

export interface Account {
  id: string;
  name: string;
}

export interface UrlMetadata {
  title: string | null;
  favicon_data_url: string | null;
}

export interface FlaggedItem {
  id: string;
  title: string;
}

export interface VaultStats {
  total: number;
  logins: number;
  notes: number;
  cards: number;
  weak: FlaggedItem[];
  reused: FlaggedItem[];
  old: FlaggedItem[];
  health_score: number;
}
