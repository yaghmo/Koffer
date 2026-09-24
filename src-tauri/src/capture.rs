//! What the browser may write into the vault when the user logs in.
//!
//! The extension captures a submitted login and, once it looks like it
//! worked, asks what to offer. These are the rules; `bridge.rs` only wraps
//! them in routes. Every write here goes through `vault::set_password`, so a
//! replaced password always lands in the item's history.

use crate::bridge::url_covers;
use crate::commands::host_of;
use crate::vault::{self, Item, ItemBase, LastSeen, LoginFields, Vault};
use uuid::Uuid;

#[derive(Debug, PartialEq)]
pub enum Offer {
    /// The user said never to save on this host.
    Never,
    /// Not approved for this browser: nothing more may be said.
    NeedsApproval,
    /// Already saved exactly like this.
    Same { id: Uuid },
    /// Same account, different password.
    Update { id: Uuid },
    /// Nothing saved for this account here.
    New,
}

/// `Me@Site.com ` and `me@site.com` are one account.
fn same_account(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// Password logins the vault would offer on this origin.
fn logins_for<'a>(
    vault: &'a Vault,
    origin: &'a str,
) -> impl Iterator<Item = (&'a ItemBase, &'a LoginFields)> {
    vault.items.iter().filter_map(move |item| match item {
        Item::Login { base, fields }
            if fields.method == "credentials" && url_covers(&fields.url, origin) =>
        {
            Some((base, fields))
        }
        _ => None,
    })
}

/// What to offer after a login that looks like it worked.
///
/// `current` is the old password from a change-password form, which often
/// carries no username; the account is then found by it.
pub fn offer_for(
    vault: &Vault,
    approved: bool,
    origin: &str,
    username: &str,
    password: &str,
    current: &str,
) -> Offer {
    let host = host_of(origin).unwrap_or_default();
    // Answered before approval, so an unapproved site the user silenced
    // stays silent. It tells a key holder the user visited the site, not
    // what the vault holds.
    if vault.never_save.iter().any(|h| *h == host) {
        return Offer::Never;
    }
    // Past here, `Same` would be a password oracle for a stolen key.
    if !approved {
        return Offer::NeedsApproval;
    }
    let found = if !username.trim().is_empty() {
        logins_for(vault, origin).find(|(_, f)| same_account(&f.username, username))
    } else if !current.is_empty() {
        logins_for(vault, origin).find(|(_, f)| f.password == current)
    } else {
        None
    };
    match found {
        Some((b, f)) if f.password == password => Offer::Same { id: b.id },
        Some((b, _)) => Offer::Update { id: b.id },
        None => Offer::New,
    }
}

/// A new login from the browser. The favicon is left for the app's usual
/// icon refresh to fill.
pub fn save_new(vault: &mut Vault, origin: &str, username: &str, password: &str, now: i64) -> Uuid {
    let id = Uuid::new_v4();
    vault::add_item(
        vault,
        Item::Login {
            base: ItemBase {
                id,
                title: host_of(origin).unwrap_or_else(|| origin.to_string()),
                notes: String::new(),
                created_at: now,
                updated_at: now,
                favicon: String::new(),
            },
            fields: LoginFields {
                method: "credentials".into(),
                url: origin.to_string(),
                username: username.trim().to_string(),
                password: password.to_string(),
                phone: String::new(),
                totp: String::new(),
                previous_passwords: vec![],
                last_seen: None,
            },
        },
    );
    id
}

/// "Update" on the bar. Only an item this origin would be offered.
pub fn update_password(
    vault: &mut Vault,
    id: Uuid,
    origin: &str,
    password: &str,
    now: i64,
) -> Result<(), &'static str> {
    match vault.items.iter_mut().find(|i| i.id() == id) {
        Some(Item::Login { base, fields })
            if fields.method == "credentials" && url_covers(&fields.url, origin) =>
        {
            vault::set_password(fields, password.to_string(), now);
            base.updated_at = now;
            Ok(())
        }
        _ => Err("no such login for this site"),
    }
}

/// "Not now" on an update: remember what worked. Returns whether anything
/// changed; the route answers the same either way.
pub fn record_seen(
    vault: &mut Vault,
    approved: bool,
    origin: &str,
    username: &str,
    password: &str,
    now: i64,
) -> bool {
    if !approved || username.trim().is_empty() {
        return false;
    }
    let Some(id) = logins_for(vault, origin)
        .find(|(_, f)| same_account(&f.username, username) && f.password != password)
        .map(|(b, _)| b.id)
    else {
        return false;
    };
    match vault.items.iter_mut().find(|i| i.id() == id) {
        Some(Item::Login { fields, .. }) => {
            fields.last_seen = Some(LastSeen { password: password.to_string(), seen_at: now });
            true
        }
        _ => false,
    }
}

/// The stored password just worked, so there is nothing to warn about.
pub fn clear_last_seen(vault: &mut Vault, id: Uuid) -> bool {
    match vault.items.iter_mut().find(|i| i.id() == id) {
        Some(Item::Login { fields, .. }) => fields.last_seen.take().is_some(),
        _ => false,
    }
}

pub fn add_never(vault: &mut Vault, host: &str) -> bool {
    if host.is_empty() || vault.never_save.iter().any(|h| h == host) {
        return false;
    }
    vault.never_save.push(host.to_string());
    true
}

pub fn remove_never(vault: &mut Vault, host: &str) -> bool {
    let before = vault.never_save.len();
    vault.never_save.retain(|h| h != host);
    vault.never_save.len() != before
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::new_vault;

    const SITE: &str = "https://site.test";

    fn vault_with(user: &str, pass: &str) -> (Vault, Uuid) {
        let mut v = new_vault(vec![0; 16]);
        let id = save_new(&mut v, SITE, user, pass, 1);
        (v, id)
    }

    #[test]
    fn a_never_site_says_never_even_unapproved() {
        let (mut v, _) = vault_with("me", "pw");
        add_never(&mut v, "site.test");
        assert_eq!(offer_for(&v, false, SITE, "me", "pw", ""), Offer::Never);
    }

    #[test]
    fn everything_else_needs_approval() {
        let (v, _) = vault_with("me", "pw");
        assert_eq!(offer_for(&v, false, SITE, "me", "pw", ""), Offer::NeedsApproval);
        assert_eq!(offer_for(&v, false, SITE, "other", "x", ""), Offer::NeedsApproval);
    }

    #[test]
    fn same_update_and_new() {
        let (v, id) = vault_with("me@site.test", "pw");
        assert_eq!(offer_for(&v, true, SITE, "me@site.test", "pw", ""), Offer::Same { id });
        assert_eq!(offer_for(&v, true, SITE, "me@site.test", "changed", ""), Offer::Update { id });
        assert_eq!(offer_for(&v, true, SITE, "someone-else", "pw", ""), Offer::New);
    }

    #[test]
    fn a_username_matches_whatever_its_case_and_spaces() {
        let (v, id) = vault_with("me@site.test", "pw");
        assert_eq!(offer_for(&v, true, SITE, "  Me@Site.TEST ", "new", ""), Offer::Update { id });
    }

    #[test]
    fn a_change_password_form_matches_on_the_current_password() {
        let (v, id) = vault_with("me", "old");
        assert_eq!(offer_for(&v, true, SITE, "", "new", "old"), Offer::Update { id });
        assert_eq!(offer_for(&v, true, SITE, "", "new", "wrong"), Offer::New);
    }

    #[test]
    fn another_site_s_login_is_never_matched() {
        let (v, _) = vault_with("me", "pw");
        assert_eq!(offer_for(&v, true, "https://other.test", "me", "pw", ""), Offer::New);
    }

    #[test]
    fn a_new_save_is_a_credentials_login_titled_by_host() {
        let (v, id) = vault_with("me", "pw");
        let Some(Item::Login { base, fields }) = vault::get_item(&v, id) else { panic!() };
        assert_eq!(base.title, "site.test");
        assert_eq!(fields.url, SITE);
        assert_eq!(fields.method, "credentials");
        assert_eq!((fields.username.as_str(), fields.password.as_str()), ("me", "pw"));
    }

    #[test]
    fn an_update_keeps_the_old_password_and_refuses_other_sites() {
        let (mut v, id) = vault_with("me", "old");
        assert!(update_password(&mut v, id, "https://evil.test", "x", 2).is_err());
        update_password(&mut v, id, SITE, "new", 2).unwrap();
        let Some(Item::Login { fields, .. }) = vault::get_item(&v, id) else { panic!() };
        assert_eq!(fields.password, "new");
        assert_eq!(fields.previous_passwords[0].password, "old");
    }

    #[test]
    fn seen_is_recorded_only_for_a_different_password_on_an_approved_site() {
        let (mut v, id) = vault_with("me", "stored");
        assert!(!record_seen(&mut v, false, SITE, "me", "other", 3));
        assert!(!record_seen(&mut v, true, SITE, "me", "stored", 3));
        assert!(!record_seen(&mut v, true, SITE, "nobody", "other", 3));
        assert!(record_seen(&mut v, true, SITE, "me", "other", 3));
        let Some(Item::Login { fields, .. }) = vault::get_item(&v, id) else { panic!() };
        assert_eq!(fields.last_seen.as_ref().unwrap().password, "other");
        assert!(clear_last_seen(&mut v, id));
        assert!(!clear_last_seen(&mut v, id));
    }

    #[test]
    fn the_never_list_has_no_duplicates_and_can_be_emptied() {
        let (mut v, _) = vault_with("me", "pw");
        assert!(add_never(&mut v, "site.test"));
        assert!(!add_never(&mut v, "site.test"));
        assert!(remove_never(&mut v, "site.test"));
        assert!(v.never_save.is_empty());
    }
}
