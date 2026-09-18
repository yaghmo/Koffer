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
