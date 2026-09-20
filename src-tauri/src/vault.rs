//! Vault data model and in-memory operations.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("serialization failed: {0}")]
    Serde(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ItemBase {
    pub id: Uuid,
    pub title: String,
    pub notes: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub favicon: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LoginFields {
    #[serde(default = "default_login_method")]
    pub method: String,
    pub url: String,
    pub username: String,
    pub password: String,
}

fn default_login_method() -> String {
    "credentials".to_string()
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

/// Single global identity profile for a vault: used to fill login/personal
/// forms (email, phone, name, social handles, job applications, ...).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct PersonalInfo {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub website: String,
    #[serde(default)]
    pub github: String,
    #[serde(default)]
    pub linkedin: String,
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub city: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub zip: String,
    #[serde(default)]
    pub country: String,
    #[serde(default)]
    pub date_of_birth: String,
    #[serde(default)]
    pub current_title: String,
    #[serde(default)]
    pub current_company: String,
    #[serde(default)]
    pub years_experience: String,
    #[serde(default)]
    pub school: String,
    #[serde(default)]
    pub degree: String,
    #[serde(default)]
    pub desired_salary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vault {
    pub version: u32,
    pub kdf_salt: Vec<u8>,
    pub items: Vec<Item>,
    #[serde(default)]
    pub personal: PersonalInfo,
    /// Pinned item ids, in the order they were pinned. Kept here rather than
    /// on the item so `save_item` (which replaces an item wholesale) can
    /// never silently drop a pin.
    #[serde(default)]
    pub pinned: Vec<Uuid>,
    /// Unix seconds of the last favicon check per item. Drives the 30-day
    /// refresh so unlocking does not re-contact every site you have an
    /// account with.
    #[serde(default)]
    pub icon_checked: std::collections::HashMap<Uuid, i64>,
    /// Worker URL and PUT token for offsite backup. Lives in the vault rather
    /// than `config.json` because that file is plaintext on disk and this is a
    /// credential; it is only needed while unlocked, which is exactly when
    /// uploads happen.
    #[serde(default)]
    pub backup: Option<crate::cloud::BackupConfig>,
    /// Browser extensions allowed to ask this vault for credentials. In the
    /// vault for the same reason `backup` is: each entry holds a bearer
    /// token, and a plaintext `config.json` would hand a local attacker the
    /// run of the vault for as long as it is unlocked.
    #[serde(default)]
    pub paired: Vec<PairedClient>,
}

/// A browser extension that has been paired with this vault.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PairedClient {
    /// `chrome-extension://<id>` — the only `Origin` this token is honoured
    /// from, pinned when the user typed the pairing code.
    pub origin: String,
    /// What to call it in Settings, e.g. "Chrome".
    pub label: String,
    /// The browser's P-256 public point, SEC1 uncompressed, hex.
    ///
    /// Not a secret, and that is the point. The browser generated the pair
    /// with WebCrypto and kept a private half it cannot export, so this field
    /// says how to *check* what that browser signs and never how to sign as
    /// it. There is no bearer string in this file to steal.
    ///
    /// Empty on a vault written before signatures replaced tokens. Empty
    /// never matches, so those pairings are dead and the browser pairs again.
    #[serde(default)]
    pub public_key: String,
    pub paired_at: i64,
    /// Unix seconds the *current* key was registered. Keys are replaced on a
    /// schedule and expire outright, so this is the clock both of those read
    /// from — `paired_at` stays put and answers "paired since when".
    #[serde(default)]
    pub key_issued_at: i64,
    /// The key this one replaced, and the moment it stops being honoured.
    ///
    /// A rekey lands on whatever call comes in first. A second call the
    /// browser had already signed with the old key would otherwise come back
    /// `401`, and the extension would tell the user to pair again over
    /// nothing. A few seconds of overlap costs far less than that.
    #[serde(default)]
    pub prev_public_key: String,
    #[serde(default)]
    pub prev_until: i64,
    /// Hosts this browser has been allowed to be handed a password for, one
    /// approval at a time.
    ///
    /// Empty is the state a fresh pairing starts in: pairing grants the
    /// ability to *ask*, never the vault. Without this a token holder could
    /// walk a domain list and collect every password in the file; with it,
    /// each new host is a dialog the user has to answer on screen.
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
}

/// How many items of each kind may be pinned at once.
pub const PIN_LIMIT_LOGIN: usize = 10;
pub const PIN_LIMIT_NOTE: usize = 5;
pub const PIN_LIMIT_CARD: usize = 5;

pub fn pin_limit(kind: &str) -> usize {
    match kind {
        "login" => PIN_LIMIT_LOGIN,
        "note" => PIN_LIMIT_NOTE,
        _ => PIN_LIMIT_CARD,
    }
}

pub fn kind_of(item: &Item) -> &'static str {
    match item {
        Item::Login { .. } => "login",
        Item::Note { .. } => "note",
        Item::Card { .. } => "card",
    }
}

/// Overwrite every secret-bearing string before the vault is dropped.
///
/// Dropping a String frees its buffer without clearing it, so passwords and
/// card numbers would sit in reusable heap memory (and could reach a page
/// file or crash dump) after locking. This does not reach copies already
/// handed to the frontend — those live in the webview's heap.
pub fn zeroize_secrets(vault: &mut Vault) {
    use zeroize::Zeroize;
    for item in vault.items.iter_mut() {
        match item {
            Item::Login { base, fields } => {
                fields.password.zeroize();
                fields.username.zeroize();
                base.notes.zeroize();
            }
            Item::Note { base, fields } => {
                fields.body.zeroize();
                base.notes.zeroize();
            }
            Item::Card { base, fields } => {
                fields.number.zeroize();
                fields.cvv.zeroize();
                fields.cardholder.zeroize();
                // Card number plus expiry is most of a usable card.
                fields.exp.zeroize();
                base.notes.zeroize();
            }
        }
        // The title alone names the site or the bank — the inventory the
        // vault exists to hide.
        item.base_mut().title.zeroize();
    }
    let p = &mut vault.personal;
    for field in [
        &mut p.name,
        &mut p.username,
        &mut p.email,
        &mut p.phone,
        &mut p.website,
        &mut p.github,
        &mut p.linkedin,
        &mut p.address,
        &mut p.city,
        &mut p.state,
        &mut p.zip,
        &mut p.country,
        &mut p.date_of_birth,
        &mut p.current_title,
        &mut p.current_company,
        &mut p.school,
        &mut p.degree,
        &mut p.desired_salary,
    ] {
        field.zeroize();
    }
    // The URL is left intact: it is not a secret, and clearing it would turn
    // backup off silently on the next unlock.
    if let Some(b) = vault.backup.as_mut() {
        b.put_token.zeroize();
    }
    // `paired` is left alone on purpose. It used to hold a bearer token, which
    // had to be wiped; it now holds a public key, which is not a secret and
    // cannot be turned into one. Nothing in that list is worth clearing, and
    // clearing the origin or the label would look like an unpairing.
}

pub fn is_pinned(vault: &Vault, id: Uuid) -> bool {
    vault.pinned.contains(&id)
}

/// Pin or unpin an item. Errors when the per-kind limit is already reached,
/// so the UI can say which limit was hit.
pub fn set_pinned(vault: &mut Vault, id: Uuid, pinned: bool) -> Result<(), String> {
    if !pinned {
        vault.pinned.retain(|p| *p != id);
        return Ok(());
    }
    if vault.pinned.contains(&id) {
        return Ok(());
    }
    let kind = kind_of(get_item(vault, id).ok_or_else(|| "not found".to_string())?);
    let limit = pin_limit(kind);
    let used = vault
        .pinned
        .iter()
        .filter(|p| get_item(vault, **p).map(kind_of) == Some(kind))
        .count();
    if used >= limit {
        return Err(format!("You can pin up to {limit} {kind}s. Unpin one first."));
    }
    vault.pinned.push(id);
    Ok(())
}

pub fn new_vault(salt: Vec<u8>) -> Vault {
    Vault {
        version: 1,
        kdf_salt: salt,
        items: Vec::new(),
        personal: PersonalInfo::default(),
        pinned: Vec::new(),
        icon_checked: std::collections::HashMap::new(),
        backup: None,
        paired: Vec::new(),
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
    // A pin pointing at a deleted item would keep a hole in the pinned row.
    vault.pinned.retain(|p| *p != id);
    vault.icon_checked.remove(&id);
}

/// Unix seconds of the item's last favicon check, 0 when never checked.
pub fn icon_checked_at(vault: &Vault, id: Uuid) -> i64 {
    vault.icon_checked.get(&id).copied().unwrap_or(0)
}

pub fn get_item(vault: &Vault, id: Uuid) -> Option<&Item> {
    vault.items.iter().find(|i| i.id() == id)
}

pub fn list_items(vault: &Vault) -> Vec<&Item> {
    vault.items.iter().collect()
}

#[derive(Debug, Serialize, PartialEq)]
pub struct FlaggedItem {
    pub id: Uuid,
    pub title: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct VaultStats {
    pub total: usize,
    pub logins: usize,
    pub notes: usize,
    pub cards: usize,
    pub weak: Vec<FlaggedItem>,
    pub reused: Vec<FlaggedItem>,
    pub old: Vec<FlaggedItem>,
    pub health_score: u8,
}

fn char_class_count(password: &str) -> usize {
    let has_lower = password.chars().any(|c| c.is_ascii_lowercase());
    let has_upper = password.chars().any(|c| c.is_ascii_uppercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_symbol = password.chars().any(|c| !c.is_ascii_alphanumeric());
    [has_lower, has_upper, has_digit, has_symbol]
        .iter()
        .filter(|b| **b)
        .count()
}

fn is_weak_password(password: &str) -> bool {
    // chars(), not len(): "🔑🔑" is 8 bytes but only 2 characters, and a
    // byte count would wave it through as strong.
    password.chars().count() < 8 || char_class_count(password) < 3
}

const OLD_PASSWORD_THRESHOLD_SECS: i64 = 90 * 86_400;

pub fn compute_stats(vault: &Vault, now: i64) -> VaultStats {
    let mut logins = 0;
    let mut notes = 0;
    let mut cards = 0;
    let mut weak = Vec::new();
    let mut password_counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for item in &vault.items {
        match item {
            Item::Login { base, fields } => {
                logins += 1;
                if is_weak_password(&fields.password) {
                    weak.push(FlaggedItem { id: base.id, title: base.title.clone() });
                }
                *password_counts.entry(fields.password.as_str()).or_insert(0) += 1;
            }
            Item::Note { .. } => notes += 1,
            Item::Card { .. } => cards += 1,
        }
    }
    let mut reused = Vec::new();
    let mut old = Vec::new();
    for item in &vault.items {
        if let Item::Login { base, fields } = item {
            if password_counts.get(fields.password.as_str()).copied().unwrap_or(0) > 1 {
                reused.push(FlaggedItem { id: base.id, title: base.title.clone() });
            }
            if now - base.updated_at > OLD_PASSWORD_THRESHOLD_SECS {
                old.push(FlaggedItem { id: base.id, title: base.title.clone() });
            }
        }
    }
    let mut flagged_ids: std::collections::HashSet<Uuid> = std::collections::HashSet::new();
    flagged_ids.extend(weak.iter().map(|f| f.id));
    flagged_ids.extend(reused.iter().map(|f| f.id));
    flagged_ids.extend(old.iter().map(|f| f.id));
    let healthy = logins - flagged_ids.len().min(logins);
    // An empty vault is not an unhealthy one, so no logins scores 100.
    let health_score = (100 * healthy).checked_div(logins).unwrap_or(100) as u8;

    VaultStats {
        total: vault.items.len(),
        logins,
        notes,
        cards,
        weak,
        reused,
        old,
        health_score,
    }
}

pub fn serialize_vault(v: &Vault) -> Result<Vec<u8>, VaultError> {
    Ok(serde_json::to_vec(v)?)
}

pub fn deserialize_vault(bytes: &[u8]) -> Result<Vault, VaultError> {
    let v: Vault = serde_json::from_slice(bytes)?;
    if v.version != 1 {
        return Err(VaultError::Serde(serde_json::Error::io(
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("unsupported vault version: {}", v.version),
            ),
        )));
    }
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zeroize_secrets_clears_passwords_and_card_data() {
        let mut v = new_vault(vec![0; 16]);
        add_item(&mut v, sample_login());
        add_item(
            &mut v,
            Item::Card {
                base: ItemBase {
                    id: Uuid::new_v4(),
                    title: "Visa".to_string(),
                    notes: "pin 1234".to_string(),
                    created_at: 0,
                    updated_at: 0,
                    favicon: String::new(),
                },
                fields: CardFields {
                    cardholder: "A Person".to_string(),
                    number: "4111111111111111".to_string(),
                    exp: "12/40".to_string(),
                    cvv: "123".to_string(),
                },
            },
        );
        v.personal.email = "me@example.com".to_string();
        zeroize_secrets(&mut v);
        for item in &v.items {
            match item {
                Item::Login { fields, .. } => assert!(fields.password.is_empty()),
                Item::Card { base, fields } => {
                    assert!(fields.number.is_empty());
                    assert!(fields.cvv.is_empty());
                    assert!(base.notes.is_empty());
                }
                Item::Note { .. } => {}
            }
        }
        assert!(v.personal.email.is_empty());
    }

    #[test]
    fn pin_limit_is_ten_logins_and_five_of_the_rest() {
        let mut v = new_vault(vec![0; 16]);
        let mut ids = Vec::new();
        for _ in 0..11 {
            let mut it = sample_login();
            it.base_mut().id = Uuid::new_v4();
            ids.push(it.id());
            add_item(&mut v, it);
        }
        for id in ids.iter().take(10) {
            set_pinned(&mut v, *id, true).unwrap();
        }
        let err = set_pinned(&mut v, ids[10], true).unwrap_err();
        assert!(err.contains("10 logins"), "{err}");
        assert_eq!(v.pinned.len(), 10);
    }

    #[test]
    fn unpinning_frees_a_slot() {
        let mut v = new_vault(vec![0; 16]);
        let a = sample_login();
        let b = {
            let mut it = sample_login();
            it.base_mut().id = Uuid::new_v4();
            it
        };
        let (ida, idb) = (a.id(), b.id());
        add_item(&mut v, a);
        add_item(&mut v, b);
        set_pinned(&mut v, ida, true).unwrap();
        assert!(is_pinned(&v, ida));
        set_pinned(&mut v, ida, false).unwrap();
        assert!(!is_pinned(&v, ida));
        set_pinned(&mut v, idb, true).unwrap();
        assert_eq!(v.pinned, vec![idb]);
    }

    #[test]
    fn pinning_twice_is_a_no_op_not_a_second_slot() {
        let mut v = new_vault(vec![0; 16]);
        let it = sample_login();
        let id = it.id();
        add_item(&mut v, it);
        set_pinned(&mut v, id, true).unwrap();
        set_pinned(&mut v, id, true).unwrap();
        assert_eq!(v.pinned.len(), 1);
    }

    #[test]
    fn deleting_an_item_drops_its_icon_timestamp() {
        let mut v = new_vault(vec![0; 16]);
        let it = sample_login();
        let id = it.id();
        add_item(&mut v, it);
        v.icon_checked.insert(id, 1_700_000_000);
        delete_item(&mut v, id);
        assert_eq!(icon_checked_at(&v, id), 0);
    }

    #[test]
    fn deleting_a_pinned_item_drops_its_pin() {
        let mut v = new_vault(vec![0; 16]);
        let it = sample_login();
        let id = it.id();
        add_item(&mut v, it);
        set_pinned(&mut v, id, true).unwrap();
        delete_item(&mut v, id);
        assert!(v.pinned.is_empty());
    }

    fn sample_login() -> Item {
        let now = 1_700_000_000;
        Item::Login {
            base: ItemBase {
                id: Uuid::new_v4(),
                title: "GitHub".to_string(),
                notes: "".to_string(),
                created_at: now,
                updated_at: now,
                favicon: String::new(),
            },
            fields: LoginFields {
                method: "credentials".to_string(),
                url: "https://github.com".to_string(),
                username: "octocat".to_string(),
                password: "s3cret".to_string(),
            },
        }
    }

    #[test]
    fn stats_counts_items_by_kind() {
        let mut v = new_vault(vec![]);
        add_item(&mut v, sample_login());
        add_item(&mut v, sample_login());
        add_item(
            &mut v,
            Item::Note {
                base: ItemBase {
                    id: Uuid::new_v4(),
                    title: "wifi".to_string(),
                    notes: "".to_string(),
                    created_at: 0,
                    updated_at: 0,
                    favicon: String::new(),
                },
                fields: NoteFields { body: "".to_string() },
            },
        );
        let stats = compute_stats(&v, 1_700_000_000);
        assert_eq!(stats.total, 3);
        assert_eq!(stats.logins, 2);
        assert_eq!(stats.notes, 1);
        assert_eq!(stats.cards, 0);
    }

    #[test]
    fn stats_flags_short_or_single_char_class_passwords_as_weak() {
        let mut v = new_vault(vec![]);
        let mut short = sample_login();
        short.base_mut().id = Uuid::new_v4();
        if let Item::Login { fields, .. } = &mut short {
            fields.password = "ab1".to_string();
        }
        let mut lettersonly = sample_login();
        lettersonly.base_mut().id = Uuid::new_v4();
        if let Item::Login { fields, .. } = &mut lettersonly {
            fields.password = "abcdefghij".to_string();
        }
        let mut strong = sample_login();
        strong.base_mut().id = Uuid::new_v4();
        if let Item::Login { fields, .. } = &mut strong {
            fields.password = "Tr0ub4dor&3xyz".to_string();
        }
        add_item(&mut v, short);
        add_item(&mut v, lettersonly);
        add_item(&mut v, strong);

        let stats = compute_stats(&v, 1_700_000_000);
        assert_eq!(stats.weak.len(), 2);
    }

    #[test]
    fn short_multibyte_passwords_are_weak() {
        let mut v = new_vault(vec![0; 16]);
        let mut it = sample_login();
        if let Item::Login { fields, .. } = &mut it {
            // 8 bytes, 2 characters.
            fields.password = "🔑🔑".to_string();
        }
        add_item(&mut v, it);
        let stats = compute_stats(&v, 1_700_000_000);
        assert_eq!(stats.weak.len(), 1);
    }

    #[test]
    fn stats_flags_passwords_reused_across_logins() {
        let mut v = new_vault(vec![]);
        let mut a = sample_login();
        a.base_mut().id = Uuid::new_v4();
        if let Item::Login { fields, .. } = &mut a {
            fields.password = "Tr0ub4dor&3xyz".to_string();
        }
        let mut b = sample_login();
        b.base_mut().id = Uuid::new_v4();
        if let Item::Login { fields, .. } = &mut b {
            fields.password = "Tr0ub4dor&3xyz".to_string();
        }
        let mut c = sample_login();
        c.base_mut().id = Uuid::new_v4();
        if let Item::Login { fields, .. } = &mut c {
            fields.password = "Unique#Pass99".to_string();
        }
        add_item(&mut v, a);
        add_item(&mut v, b);
        add_item(&mut v, c);

        let stats = compute_stats(&v, 1_700_000_000);
        assert_eq!(stats.reused.len(), 2);
    }

    #[test]
    fn stats_flags_logins_not_updated_in_over_90_days_as_old() {
        let now = 1_700_000_000;
        let ninety_one_days_ago = now - 91 * 86_400;
        let mut v = new_vault(vec![]);
        let mut stale = sample_login();
        stale.base_mut().id = Uuid::new_v4();
        stale.base_mut().updated_at = ninety_one_days_ago;
        if let Item::Login { fields, .. } = &mut stale {
            fields.password = "Tr0ub4dor&3xyz".to_string();
        }
        let mut fresh = sample_login();
        fresh.base_mut().id = Uuid::new_v4();
        fresh.base_mut().updated_at = now;
        if let Item::Login { fields, .. } = &mut fresh {
            fields.password = "Unique#Pass99".to_string();
        }
        add_item(&mut v, stale);
        add_item(&mut v, fresh);

        let stats = compute_stats(&v, now);
        assert_eq!(stats.old.len(), 1);
    }

    #[test]
    fn stats_health_score_is_percent_of_logins_with_no_flags() {
        let mut v = new_vault(vec![]);
        let mut weak = sample_login();
        weak.base_mut().id = Uuid::new_v4();
        if let Item::Login { fields, .. } = &mut weak {
            fields.password = "abc".to_string();
        }
        let mut ok1 = sample_login();
        ok1.base_mut().id = Uuid::new_v4();
        if let Item::Login { fields, .. } = &mut ok1 {
            fields.password = "Unique#Pass99".to_string();
        }
        let mut ok2 = sample_login();
        ok2.base_mut().id = Uuid::new_v4();
        if let Item::Login { fields, .. } = &mut ok2 {
            fields.password = "An0ther$Strong1".to_string();
        }
        let mut ok3 = sample_login();
        ok3.base_mut().id = Uuid::new_v4();
        if let Item::Login { fields, .. } = &mut ok3 {
            fields.password = "YetAn0ther$Str1".to_string();
        }
        add_item(&mut v, weak);
        add_item(&mut v, ok1);
        add_item(&mut v, ok2);
        add_item(&mut v, ok3);

        let stats = compute_stats(&v, 1_700_000_000);
        assert_eq!(stats.health_score, 75);
    }

    #[test]
    fn stats_health_score_is_100_when_no_logins() {
        let v = new_vault(vec![]);
        let stats = compute_stats(&v, 1_700_000_000);
        assert_eq!(stats.health_score, 100);
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

    #[test]
    fn vault_json_roundtrip_preserves_items() {
        let mut v = new_vault(vec![1, 2, 3, 4]);
        add_item(&mut v, sample_login());
        add_item(
            &mut v,
            Item::Note {
                base: ItemBase {
                    id: Uuid::new_v4(),
                    title: "wifi".to_string(),
                    notes: "router pw".to_string(),
                    created_at: 0,
                    updated_at: 0,
                    favicon: String::new(),
                },
                fields: NoteFields {
                    body: "abc123".to_string(),
                },
            },
        );
        let bytes = serialize_vault(&v).unwrap();
        let v2 = deserialize_vault(&bytes).unwrap();
        assert_eq!(v2.version, 1);
        assert_eq!(v2.kdf_salt, vec![1, 2, 3, 4]);
        assert_eq!(v2.items.len(), 2);
    }

    #[test]
    fn deserialize_vault_rejects_garbage() {
        assert!(deserialize_vault(b"not json").is_err());
        assert!(deserialize_vault(b"").is_err());
    }

    #[test]
    fn old_vault_without_personal_deserializes_to_default_profile() {
        let json = br#"{"version":1,"kdf_salt":[1,2,3],"items":[]}"#;
        let v = deserialize_vault(json).unwrap();
        assert_eq!(v.personal, PersonalInfo::default());
        assert_eq!(v.personal.email, "");
    }

    #[test]
    fn personal_roundtrip_preserves_fields() {
        let mut v = new_vault(vec![]);
        v.personal = PersonalInfo {
            name: "Ada L".to_string(),
            username: "ada".to_string(),
            email: "ada@example.com".to_string(),
            phone: "+15551234567".to_string(),
            website: "https://ada.example".to_string(),
            github: "adagithub".to_string(),
            linkedin: "adalinkedin".to_string(),
            address: "1 Maths Road".to_string(),
            city: "London".to_string(),
            state: "".to_string(),
            zip: "W1T 3AL".to_string(),
            country: "UK".to_string(),
            date_of_birth: "1815-12-10".to_string(),
            current_title: "Analytical Engine Programmer".to_string(),
            current_company: "Babbage & Co".to_string(),
            years_experience: "15".to_string(),
            school: "University of London".to_string(),
            degree: "Mathematics".to_string(),
            desired_salary: "80000".to_string(),
        };
        let bytes = serialize_vault(&v).unwrap();
        let v2 = deserialize_vault(&bytes).unwrap();
        assert_eq!(v2.personal, v.personal);
    }

    #[test]
    fn vaults_without_a_backup_field_still_load() {
        // Existing vaults predate the field; serde(default) must carry them.
        let json = r#"{"version":3,"kdf_salt":[1,2,3],"items":[]}"#;
        let v: Vault = serde_json::from_str(json).unwrap();
        assert!(v.backup.is_none());
    }

    #[test]
    fn zeroize_wipes_the_stored_put_token() {
        let mut v = new_vault(vec![1, 2, 3]);
        v.backup = Some(crate::cloud::BackupConfig {
            url: "https://w.example.dev".into(),
            put_token: "secret-token".into(),
        });
        zeroize_secrets(&mut v);
        let token = &v.backup.as_ref().unwrap().put_token;
        assert!(!token.contains("secret-token"), "token survived the wipe");
    }

    #[test]
    fn zeroize_keeps_the_backup_url() {
        // The URL is not a secret, and blanking it would silently disable
        // backup on the next unlock.
        let mut v = new_vault(vec![1, 2, 3]);
        v.backup = Some(crate::cloud::BackupConfig {
            url: "https://w.example.dev".into(),
            put_token: "secret-token".into(),
        });
        zeroize_secrets(&mut v);
        assert_eq!(v.backup.as_ref().unwrap().url, "https://w.example.dev");
    }
}
