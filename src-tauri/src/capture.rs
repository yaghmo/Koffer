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
    if is_never(vault, &host) {
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
        // The password step of a two-step sign-in has no username box. A
        // login whose password matches is this one; nothing else can be.
        logins_for(vault, origin).find(|(_, f)| f.password == password)
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
                password_from_browser: true,
            },
        },
    );
    id
}

/// `save_new`, written straight away; if the write fails the item is taken
/// back out, so a retry cannot leave two copies behind.
pub fn save_new_or_undo(
    vault: &mut Vault,
    origin: &str,
    username: &str,
    password: &str,
    now: i64,
    write: impl FnOnce(&Vault) -> Result<(), String>,
) -> Result<Uuid, String> {
    let id = save_new(vault, origin, username, password, now);
    if let Err(e) = write(vault) {
        vault::delete_item(vault, id);
        return Err(e);
    }
    Ok(id)
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
            vault::set_password_from(fields, password.to_string(), now, true);
            base.updated_at = now;
        }
        _ => return Err("no such login for this site"),
    }
    Ok(())
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

/// What to offer after a 2FA setup page took its first code.
#[derive(Debug, PartialEq)]
pub enum KeyOffer {
    Never,
    NeedsApproval,
    /// No key on the page made the code, or no one login here can take it.
    Nothing,
    /// The login it would go on already has a key, which the browser never
    /// replaces. Said, rather than nothing, so the user knows why.
    HasKey { id: Uuid },
    /// Offer to put `key` on login `id`.
    Add { id: Uuid, key: String },
}

/// `keys` are what the page showed: links read from its QR codes, and
/// anything printed that looks like a key. Only one that made the `code`
/// the user typed is offered -- that is what proves it is the key the site
/// issued, and it is also what makes a stray base32-looking word harmless.
///
/// The login is the one the QR code names, else `last` -- the login the
/// extension last saw used on this site -- else the site's only login.
/// One that already has a key is left alone: the browser adds a key and
/// never replaces one, so a page cannot swap a working key for its own.
///
/// ponytail: several logins on one site, a QR code naming none of them and
/// no login seen used gets no offer; a picker on the bar if that is common.
pub fn key_offer_for(
    vault: &Vault,
    approved: bool,
    origin: &str,
    code: &str,
    keys: &[String],
    last: Option<Uuid>,
    now: u64,
) -> KeyOffer {
    // The page's own data first: whether it shows a key is no secret, and
    // answering it before approval keeps a sign-in page's code box, next to
    // a square logo, from raising "approve this site" for nothing.
    let Some((key, totp)) = keys.iter().find_map(|k| {
        let t = crate::totp::parse(k).ok()?;
        crate::totp::made_code(&t, code, now).then(|| (k.trim().to_string(), t))
    }) else {
        return KeyOffer::Nothing;
    };
    let host = host_of(origin).unwrap_or_default();
    if is_never(vault, &host) {
        return KeyOffer::Never;
    }
    if !approved {
        return KeyOffer::NeedsApproval;
    }
    let logins: Vec<_> = logins_for(vault, origin).collect();
    // The account the QR code is for. A label that is only the issuer names
    // nobody; one that names an account no saved login has is for an
    // account this vault does not hold, and goes nowhere -- not onto
    // whichever login happens to be the only one here.
    let account = totp.account_name.trim();
    let issuer = totp.issuer.as_deref().unwrap_or("").trim();
    let names_one = !account.is_empty() && !account.eq_ignore_ascii_case(issuer);
    let named = logins.iter().find(|(_, f)| names_one && same_account(&f.username, account));
    if names_one && named.is_none() {
        return KeyOffer::Nothing;
    }
    let used = logins.iter().find(|(b, _)| Some(b.id) == last);
    let pick = named.or(used).or(if logins.len() == 1 { logins.first() } else { None });
    let held = key_is_held(vault, &totp);
    match pick {
        Some((b, f)) if !f.totp.trim().is_empty() => KeyOffer::HasKey { id: b.id },
        Some(_) if held => KeyOffer::Nothing,
        Some((b, _)) => KeyOffer::Add { id: b.id, key },
        None => KeyOffer::Nothing,
    }
}

/// A site issues one key per account. One a saved login already holds is
/// that login's, shown again -- a sign-in page's hint, say -- and putting it
/// on a second login gives two accounts the same codes.
fn key_is_held(vault: &Vault, totp: &totp_rs::TOTP) -> bool {
    vault.items.iter().any(|i| match i {
        Item::Login { fields, .. } => crate::totp::parse(&fields.totp).is_ok_and(|t| t.secret == totp.secret),
        _ => false,
    })
}

/// "Save" on a 2FA offer: onto a login this origin would be offered, and
/// only one that has no key yet, with a key no other login holds (see
/// `key_offer_for`). Checked again here: this route is callable directly.
pub fn add_key(vault: &mut Vault, id: Uuid, origin: &str, key: &str, now: i64) -> Result<(), &'static str> {
    let Ok(totp) = crate::totp::parse(key) else {
        return Err("not a 2FA key");
    };
    if key_is_held(vault, &totp) {
        return Err("another login already has that 2FA key");
    }
    match vault.items.iter_mut().find(|i| i.id() == id) {
        Some(Item::Login { base, fields })
            if fields.method == "credentials" && url_covers(&fields.url, origin) && fields.totp.trim().is_empty() =>
        {
            fields.totp = key.trim().to_string();
            base.updated_at = now;
            Ok(())
        }
        _ => Err("no login here without a 2FA key"),
    }
}

/// Most hosts the never list holds. It is the one write a key holder can
/// make for an unapproved host, so it must not grow without bound.
pub const MAX_NEVER: usize = 500;

pub fn is_never(vault: &Vault, host: &str) -> bool {
    vault.never_save.iter().any(|h| h == host)
}

pub fn add_never(vault: &mut Vault, host: &str) -> bool {
    if host.is_empty() || vault.never_save.len() >= MAX_NEVER || vault.never_save.iter().any(|h| h == host) {
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

    // RFC 6238's key; its code at t=59 is 287082.
    const KEY: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    fn totp_of(v: &Vault, id: Uuid) -> String {
        match v.items.iter().find(|i| i.id() == id) {
            Some(Item::Login { fields, .. }) => fields.totp.clone(),
            _ => panic!("no login"),
        }
    }

    #[test]
    fn a_key_is_offered_only_when_it_made_the_typed_code() {
        let (v, id) = vault_with("me", "pw");
        let keys = vec!["this code will make".to_string(), KEY.to_string()];
        assert_eq!(
            key_offer_for(&v, true, SITE, "287082", &keys, None, 59),
            KeyOffer::Add { id, key: KEY.to_string() }
        );
        assert_eq!(key_offer_for(&v, true, SITE, "123456", &keys, None, 59), KeyOffer::Nothing);
        assert_eq!(key_offer_for(&v, false, SITE, "287082", &keys, None, 59), KeyOffer::NeedsApproval);
        assert_eq!(key_offer_for(&v, false, SITE, "123456", &keys, None, 59), KeyOffer::Nothing);
        assert_eq!(key_offer_for(&v, true, "https://other.test", "287082", &keys, None, 59), KeyOffer::Nothing);
    }

    #[test]
    fn a_key_goes_to_the_login_its_qr_code_names() {
        let (mut v, _) = vault_with("someone", "pw");
        let me = save_new(&mut v, SITE, "Me@Site.test", "pw2", 1);
        let link = format!("otpauth://totp/Site:me@site.test?secret={KEY}&issuer=Site");
        assert_eq!(
            key_offer_for(&v, true, SITE, "287082", std::slice::from_ref(&link), None, 59),
            KeyOffer::Add { id: me, key: link }
        );
        // A bare key names nobody, and two logins leave no one to pick.
        assert_eq!(key_offer_for(&v, true, SITE, "287082", &[KEY.to_string()], None, 59), KeyOffer::Nothing);
    }

    #[test]
    fn a_key_goes_to_the_login_just_used_when_the_qr_code_names_nobody() {
        let (mut v, _) = vault_with("someone", "pw");
        let used = save_new(&mut v, SITE, "other", "pw2", 1);
        assert_eq!(
            key_offer_for(&v, true, SITE, "287082", &[KEY.to_string()], Some(used), 59),
            KeyOffer::Add { id: used, key: KEY.to_string() }
        );
        // Another site's login is never "the one just used" here.
        let elsewhere = save_new(&mut v, "https://other.test", "x", "y", 1);
        assert_eq!(
            key_offer_for(&v, true, SITE, "287082", &[KEY.to_string()], Some(elsewhere), 59),
            KeyOffer::Nothing
        );
    }

    #[test]
    fn a_qr_code_for_an_account_the_vault_does_not_hold_goes_nowhere() {
        let (v, only) = vault_with("alice@site.test", "pw");
        let bob = format!("otpauth://totp/Site:bob@site.test?secret={KEY}&issuer=Site");
        assert_eq!(key_offer_for(&v, true, SITE, "287082", &[bob], Some(only), 59), KeyOffer::Nothing);
        // A label that is only the issuer names nobody.
        let unnamed = format!("otpauth://totp/Site?secret={KEY}&issuer=Site");
        assert_eq!(
            key_offer_for(&v, true, SITE, "287082", std::slice::from_ref(&unnamed), None, 59),
            KeyOffer::Add { id: only, key: unnamed }
        );
    }

    #[test]
    fn a_saved_key_cannot_be_written_onto_a_second_login() {
        let (mut v, a) = vault_with("someone", "pw");
        add_key(&mut v, a, SITE, KEY, 1).unwrap();
        let b = save_new(&mut v, SITE, "other", "pw2", 1);
        assert_eq!(add_key(&mut v, b, SITE, KEY, 2), Err("another login already has that 2FA key"));
    }

    #[test]
    fn a_key_another_login_holds_is_never_offered_again() {
        let (mut v, a) = vault_with("someone", "pw");
        add_key(&mut v, a, SITE, KEY, 1).unwrap();
        let b = save_new(&mut v, SITE, "other", "pw2", 1);
        // The same key, even written as a link, is still someone's.
        let link = format!("otpauth://totp/Site?secret={KEY}");
        for k in [KEY.to_string(), link] {
            assert_eq!(key_offer_for(&v, true, SITE, "287082", &[k], Some(b), 59), KeyOffer::Nothing);
        }
    }

    #[test]
    fn a_key_is_added_never_replaced() {
        let (mut v, id) = vault_with("me", "pw");
        assert_eq!(add_key(&mut v, id, "https://other.test", KEY, 5), Err("no login here without a 2FA key"));
        assert_eq!(add_key(&mut v, id, SITE, "not a key", 5), Err("not a 2FA key"));
        add_key(&mut v, id, SITE, KEY, 5).unwrap();
        assert_eq!(totp_of(&v, id), KEY);
        let other = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
        assert!(add_key(&mut v, id, SITE, other, 6).is_err());
        assert_eq!(totp_of(&v, id), KEY);
        assert_eq!(key_offer_for(&v, true, SITE, "287082", &[KEY.to_string()], None, 59), KeyOffer::HasKey { id });
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
    fn a_password_only_step_matches_its_login_by_password() {
        // Two-step sign-ins ask for the password on a page with no username.
        let (v, id) = vault_with("me", "pw");
        assert_eq!(offer_for(&v, true, SITE, "", "pw", ""), Offer::Same { id });
    }

    #[test]
    fn a_stolen_key_cannot_push_a_user_set_password_out_of_history() {
        let (mut v, id) = vault_with("me", "user-set");
        // Make it a password the user chose in the app.
        let Some(Item::Login { fields, .. }) = v.items.iter_mut().find(|i| i.id() == id) else { panic!() };
        fields.password_from_browser = false;
        for i in 0..20 {
            update_password(&mut v, id, SITE, &format!("junk{i}"), 10 + i).unwrap();
        }
        let Some(Item::Login { fields, .. }) = vault::get_item(&v, id) else { panic!() };
        assert!(fields.previous_passwords.iter().any(|p| p.password == "user-set"));
        assert!(fields.previous_passwords.len() <= vault::MAX_PREVIOUS);
    }

    #[test]
    fn the_never_list_stops_growing_at_its_cap() {
        let (mut v, _) = vault_with("me", "pw");
        for i in 0..MAX_NEVER + 10 {
            add_never(&mut v, &format!("site{i}.test"));
        }
        assert_eq!(v.never_save.len(), MAX_NEVER);
    }

    #[test]
    fn a_save_that_cannot_be_written_leaves_nothing_behind() {
        let mut v = new_vault(vec![0; 16]);
        let failed = save_new_or_undo(&mut v, SITE, "me", "pw", 1, |_| Err("disk full".into()));
        assert!(failed.is_err());
        assert!(v.items.is_empty());
        let id = save_new_or_undo(&mut v, SITE, "me", "pw", 1, |_| Ok(())).unwrap();
        assert!(vault::get_item(&v, id).is_some());
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
