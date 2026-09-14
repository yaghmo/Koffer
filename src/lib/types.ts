export type ItemKind = "login" | "note" | "card";

export interface ItemBase {
  id: string;
  title: string;
  notes: string;
  created_at: number;
  updated_at: number;
  favicon: string;
}

export type LoginMethod = "credentials" | "google" | "github" | "microsoft" | "apple" | "facebook";

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
}

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
