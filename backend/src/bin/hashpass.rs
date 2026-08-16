// One-off helper for #87: print an argon2 hash for a password given on argv.
// Usage: hashpass <password>
// Used at deploy time to rotate seed-user passwords WITHOUT storing plaintext
// or shipping hashes in git history. Self-contained (no crate root needed).
use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
use argon2::Argon2;

fn main() {
    let pw = std::env::args().nth(1).expect("usage: hashpass <password>");
    let salt = SaltString::generate(&mut OsRng);
    match Argon2::default().hash_password(pw.as_bytes(), &salt) {
        Ok(h) => println!("{h}"),
        Err(e) => {
            eprintln!("hash failed: {e}");
            std::process::exit(1);
        }
    }
}
