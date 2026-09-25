//! Two-factor codes (RFC 6238) for login items.
//!
//! A login's `totp` field holds what the site handed over when 2FA was
//! turned on: either the `otpauth://totp/...` link inside its QR code, or the
//! bare base32 key it shows under "can't scan it?". Everything here reads
//! that one string; the maths is `totp-rs`, checked against the RFC below.

use serde::Serialize;
use totp_rs::{Algorithm, Secret, TOTP};

/// Shortest key accepted, in bytes. 80 bits is what the oldest services
/// still issue; anything shorter is a typo or the wrong thing pasted.
const MIN_KEY_BYTES: usize = 10;

#[derive(Debug, Serialize, PartialEq)]
pub struct Code {
    pub code: String,
    /// Until this code is replaced, for the countdown beside it.
    pub seconds_left: u64,
}

/// Read a `totp` field. Errors are worded for the editor, which shows them.
pub fn parse(input: &str) -> Result<TOTP, String> {
    let s = input.trim();
    if s.to_ascii_lowercase().starts_with("otpauth://") {
        // Unchecked: the checked parser refuses the 80-bit keys plenty of
        // real sites still hand out.
        let totp =
            TOTP::from_url_unchecked(s).map_err(|_| "Not a valid 2FA setup link.".to_string())?;
        if totp.secret.len() < MIN_KEY_BYTES {
            return Err("That 2FA key is too short.".into());
        }
        return Ok(totp);
    }
    // Sites print keys in groups ("JBSW Y3DP ..."), sometimes lowercase.
    let key: String = s
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '=')
        .collect::<String>()
        .to_ascii_uppercase();
    let bytes = Secret::Encoded(key)
        .to_bytes()
        .map_err(|_| "Not a valid 2FA key. It should be letters A-Z and digits 2-7.".to_string())?;
    if bytes.len() < MIN_KEY_BYTES {
        return Err("That 2FA key is too short.".into());
    }
    Ok(TOTP::new_unchecked(
        Algorithm::SHA1,
        6,
        1,
        30,
        bytes,
        None,
        String::new(),
    ))
}

/// The code at a unix time, and how long it has left.
pub fn code_at(totp: &TOTP, unix: u64) -> Code {
    Code {
        code: totp.generate(unix),
        seconds_left: totp.step - unix % totp.step,
    }
}

/// Find a 2FA setup QR code in an RGBA image and return its link.
///
/// The desktop has no camera to point at the site's QR code, so the user
/// screenshots it to the clipboard instead and this reads it back.
pub fn qr_from_rgba(width: usize, height: usize, rgba: &[u8]) -> Result<String, String> {
    if rgba.len() < width * height * 4 {
        return Err("The copied image could not be read.".into());
    }
    // Light-on-dark first fails, then reads: a dark-themed page draws its QR
    // code inverted, and the decoder only looks for dark modules.
    let text = [false, true]
        .into_iter()
        .find_map(|invert| {
            let mut img = rqrr::PreparedImage::prepare_from_greyscale(width, height, |x, y| {
                let i = (y * width + x) * 4;
                // Luma, near enough; the QR only needs dark told from light.
                let luma = ((rgba[i] as u16 * 3 + rgba[i + 1] as u16 * 6 + rgba[i + 2] as u16) / 10) as u8;
                if invert { 255 - luma } else { luma }
            });
            img.detect_grids().iter().find_map(|g| g.decode().ok().map(|(_, text)| text))
        })
        .ok_or_else(|| "No QR code found in the copied image.".to_string())?;
    if !text.to_ascii_lowercase().starts_with("otpauth://totp/") {
        return Err("That QR code is not a 2FA setup code.".into());
    }
    parse(&text)?;
    Ok(text)
}

/// The key drawn back as a QR code, so the editor can show that it was read.
/// A bare key gets a link of its own; either way an authenticator app can
/// scan the result.
pub fn qr_svg(input: &str) -> Result<String, String> {
    parse(input)?;
    let s = input.trim();
    let link = if s.to_ascii_lowercase().starts_with("otpauth://") {
        s.to_string()
    } else {
        let key: String = s.chars().filter(|c| !c.is_whitespace() && *c != '-').collect();
        format!("otpauth://totp/Password%20Manager?secret={}", key.to_ascii_uppercase())
    };
    let code = qrcode::QrCode::new(link.as_bytes()).map_err(|_| "That key is too long to draw.".to_string())?;
    Ok(code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(160, 160)
        .dark_color(qrcode::render::svg::Color("#000000"))
        .light_color(qrcode::render::svg::Color("#ffffff"))
        .build())
}

#[cfg(test)]
mod tests {
    use super::*;

    // RFC 6238 appendix B, SHA-1: the key is ASCII "12345678901234567890".
    const RFC_KEY: &str = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    #[test]
    fn matches_the_rfc_test_vectors() {
        let t = parse(RFC_KEY).unwrap();
        // The RFC lists 8 digits; 6-digit codes are the last six of those.
        for (time, eight) in [
            (59, "94287082"),
            (1111111109, "07081804"),
            (1111111111, "14050471"),
            (1234567890, "89005924"),
            (2000000000, "69279037"),
        ] {
            assert_eq!(code_at(&t, time).code, eight[2..], "at {time}");
        }
    }

    #[test]
    fn reads_a_key_the_way_sites_print_it() {
        let grouped = "gezd gnbv gy3t qojq gezd gnbv gy3t qojq";
        assert_eq!(code_at(&parse(grouped).unwrap(), 59).code, "287082");
    }

    #[test]
    fn reads_an_otpauth_link() {
        let url = format!("otpauth://totp/Site:me@example.com?secret={RFC_KEY}&issuer=Site");
        assert_eq!(code_at(&parse(&url).unwrap(), 59).code, "287082");
    }

    #[test]
    fn honours_digits_and_period_in_a_link() {
        let url = format!("otpauth://totp/x?secret={RFC_KEY}&digits=8&period=60");
        let t = parse(&url).unwrap();
        assert_eq!(code_at(&t, 59).code.len(), 8);
        assert_eq!(code_at(&t, 59).seconds_left, 1);
    }

    #[test]
    fn counts_down_to_the_next_code() {
        let t = parse(RFC_KEY).unwrap();
        assert_eq!(code_at(&t, 60).seconds_left, 30);
        assert_eq!(code_at(&t, 89).seconds_left, 1);
    }

    #[test]
    fn refuses_what_is_not_a_key() {
        assert!(parse("123456").is_err()); // 0, 1, 8, 9 are not base32
        assert!(parse("ABCDEFGH").is_err()); // valid, but 5 bytes
        assert!(parse("otpauth://hotp/x?secret=ABC").is_err());
        assert!(parse("otpauth://totp/x?issuer=nosecret").is_err());
    }

    /// Render `text` as a QR code, the way a screenshot of it arrives: RGBA,
    /// several pixels per module, with a white margin.
    fn qr_screenshot(text: &str) -> (usize, usize, Vec<u8>) {
        let code = qrcode::QrCode::new(text).unwrap();
        let (n, scale, margin) = (code.width(), 6, 24);
        let side = n * scale + margin * 2;
        let mut rgba = vec![255u8; side * side * 4];
        for y in 0..n {
            for x in 0..n {
                if code[(x, y)] == qrcode::Color::Dark {
                    for py in 0..scale {
                        for px in 0..scale {
                            let i = ((margin + y * scale + py) * side + margin + x * scale + px) * 4;
                            rgba[i..i + 3].fill(0);
                        }
                    }
                }
            }
        }
        (side, side, rgba)
    }

    #[test]
    fn reads_a_2fa_qr_code_from_a_screenshot() {
        let link = format!("otpauth://totp/Site:me?secret={RFC_KEY}&issuer=Site");
        let (w, h, rgba) = qr_screenshot(&link);
        assert_eq!(qr_from_rgba(w, h, &rgba).unwrap(), link);
    }

    #[test]
    fn refuses_a_qr_code_that_is_not_for_2fa() {
        let (w, h, rgba) = qr_screenshot("https://example.com");
        assert!(qr_from_rgba(w, h, &rgba).unwrap_err().contains("not a 2FA"));
    }

    #[test]
    fn reads_a_light_on_dark_qr_code() {
        let link = format!("otpauth://totp/Site:me?secret={RFC_KEY}&issuer=Site");
        let (w, h, mut rgba) = qr_screenshot(&link);
        for px in rgba.chunks_mut(4) {
            for c in &mut px[..3] {
                *c = 255 - *c;
            }
        }
        assert_eq!(qr_from_rgba(w, h, &rgba).unwrap(), link);
    }

    #[test]
    fn draws_a_key_back_as_a_qr_code() {
        assert!(qr_svg(RFC_KEY).unwrap().starts_with("<?xml"));
        assert!(qr_svg("otpauth://totp/x?secret=nope!").is_err());
    }

    #[test]
    fn a_blank_image_has_no_qr() {
        let white = vec![255u8; 40 * 40 * 4];
        assert!(qr_from_rgba(40, 40, &white).is_err());
    }
}

