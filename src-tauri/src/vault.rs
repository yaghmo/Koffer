//! Vault data model and in-memory operations.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ItemBase {
    pub id: Uuid,
    pub title: String,
    pub notes: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LoginFields {
    pub url: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NoteFields {
    pub body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CardFields {
    pub cardholder: String,
    pub number: String,
    pub exp: String,
    pub cvv: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Item {
    Login {
        #[serde(flatten)]
        base: ItemBase,
        #[serde(flatten)]
        fields: LoginFields,
    },
    Note {
        #[serde(flatten)]
        base: ItemBase,
        #[serde(flatten)]
        fields: NoteFields,
    },
    Card {
        #[serde(flatten)]
        base: ItemBase,
        #[serde(flatten)]
        fields: CardFields,
    },
}

impl Item {
    pub fn id(&self) -> Uuid {
        match self {
            Item::Login { base, .. } => base.id,
            Item::Note { base, .. } => base.id,
            Item::Card { base, .. } => base.id,
        }
    }

    pub fn base(&self) -> &ItemBase {
        match self {
            Item::Login { base, .. } => base,
            Item::Note { base, .. } => base,
            Item::Card { base, .. } => base,
        }
    }

    pub fn base_mut(&mut self) -> &mut ItemBase {
        match self {
            Item::Login { base, .. } => base,
            Item::Note { base, .. } => base,
            Item::Card { base, .. } => base,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vault {
    pub version: u32,
    pub kdf_salt: Vec<u8>,
    pub items: Vec<Item>,
}

pub fn new_vault(salt: Vec<u8>) -> Vault {
    Vault {
        version: 1,
        kdf_salt: salt,
        items: Vec::new(),
    }
}

pub fn add_item(vault: &mut Vault, item: Item) {
    vault.items.push(item);
}

pub fn update_item(vault: &mut Vault, item: Item) {
    let id = item.id();
    if let Some(existing) = vault.items.iter_mut().find(|i| i.id() == id) {
        *existing = item;
    }
}

pub fn delete_item(vault: &mut Vault, id: Uuid) {
    vault.items.retain(|i| i.id() != id);
}

pub fn get_item(vault: &Vault, id: Uuid) -> Option<&Item> {
    vault.items.iter().find(|i| i.id() == id)
}

pub fn list_items(vault: &Vault) -> Vec<&Item> {
    vault.items.iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_login() -> Item {
        let now = 1_700_000_000;
        Item::Login {
            base: ItemBase {
                id: Uuid::new_v4(),
                title: "GitHub".to_string(),
                notes: "".to_string(),
                created_at: now,
                updated_at: now,
            },
            fields: LoginFields {
                url: "https://github.com".to_string(),
                username: "octocat".to_string(),
                password: "s3cret".to_string(),
            },
        }
    }

    #[test]
    fn new_vault_has_version_one_and_empty_items() {
        let v = new_vault(vec![1, 2, 3]);
        assert_eq!(v.version, 1);
        assert!(v.items.is_empty());
        assert_eq!(v.kdf_salt, vec![1, 2, 3]);
    }

    #[test]
    fn add_then_get_item() {
        let mut v = new_vault(vec![]);
        let item = sample_login();
        let id = item.id();
        add_item(&mut v, item);
        assert_eq!(get_item(&v, id).unwrap().id(), id);
    }

    #[test]
    fn update_item_replaces_existing() {
        let mut v = new_vault(vec![]);
        let mut item = sample_login();
        add_item(&mut v, item.clone());
        item.base_mut().title = "GitHub2".to_string();
        update_item(&mut v, item.clone());
        assert_eq!(get_item(&v, item.id()).unwrap().base().title, "GitHub2");
    }

    #[test]
    fn delete_item_removes_by_id() {
        let mut v = new_vault(vec![]);
        let item = sample_login();
        let id = item.id();
        add_item(&mut v, item);
        delete_item(&mut v, id);
        assert!(get_item(&v, id).is_none());
    }

    #[test]
    fn list_items_returns_all() {
        let mut v = new_vault(vec![]);
        add_item(&mut v, sample_login());
        add_item(&mut v, sample_login());
        assert_eq!(list_items(&v).len(), 2);
    }
}
