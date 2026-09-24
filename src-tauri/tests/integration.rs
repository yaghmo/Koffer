use password_manager_lib::{
    add_item, derive_key, deserialize_vault, encrypt, generate, new_vault, random_bytes,
    serialize_vault, Item, ItemBase, LoginFields,
};
use uuid::Uuid;

#[test]
fn full_vault_lifecycle() {
    let salt = random_bytes(16);
    let key = derive_key("master-password-123", &salt);
    let mut v = new_vault(salt);
    let item = Item::Login {
        base: ItemBase {
            id: Uuid::new_v4(),
            title: "GitHub".to_string(),
            notes: "".to_string(),
            created_at: 0,
            updated_at: 0,
            favicon: String::new(),
        },
        fields: LoginFields {
            method: "credentials".to_string(),
            url: "https://github.com".to_string(),
            username: "octocat".to_string(),
            password: "s3cret".to_string(),
            phone: String::new(),
            totp: String::new(),
            previous_passwords: vec![],
            last_seen: None,
            password_from_browser: false,
        },
    };
    add_item(&mut v, item.clone());

    // JSON roundtrip
    let bytes = serialize_vault(&v).unwrap();
    let v2 = deserialize_vault(&bytes).unwrap();
    assert_eq!(v2.items.len(), 1);

    // Crypto roundtrip on the JSON bytes
    let (nonce, ct) = encrypt(&key, &bytes);
    let back = password_manager_lib::decrypt(&key, &nonce, &ct).unwrap();
    let v3 = deserialize_vault(&back).unwrap();
    assert_eq!(v3.items[0].id(), item.id());
}

#[test]
fn password_generator_works() {
    let p = generate(&password_manager_lib::GenOpts::default()).unwrap();
    assert_eq!(p.len(), 20);
}
