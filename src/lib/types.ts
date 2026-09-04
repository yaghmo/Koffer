export type ItemKind = "login" | "note" | "card";

export interface ItemBase {
  id: string;
  title: string;
  notes: string;
  created_at: number;
  updated_at: number;
}

export interface LoginFields {
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
