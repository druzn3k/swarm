//! lz-string `compressToBase64` / `decompressFromBase64`, byte-compatible
//! with the JS library (`lz-string` 1.4/1.5).
//!
//! The `lz-str` crate's decompressor matches the JS one, but its
//! `compress_to_base64` pads one `=` too many whenever the output length is
//! not a multiple of 4 (`"Q===="` where JS writes `"Q==="`). [`compress_to_base64`]
//! re-pads the output the way JS does; the vectors in
//! `swarmsim-ts/src/persist.test.json` check it.

/// JS `LZString.compressToBase64(text)`.
pub fn compress_to_base64(text: &str) -> String {
    let mut out = lz_str::compress_to_base64(text);
    while out.ends_with('=') {
        out.pop();
    }
    while !out.len().is_multiple_of(4) {
        out.push('=');
    }
    out
}

/// JS `LZString.decompressFromBase64(text)`. `None` where the JS returns
/// `null` (corrupt input) or a string that is not valid UTF-16.
pub fn decompress_from_base64(text: &str) -> Option<String> {
    if text.is_empty() {
        // JS returns null for "".
        return None;
    }
    let wide = lz_str::decompress_from_base64(text)?;
    String::from_utf16(&wide).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pads_like_js() {
        assert_eq!(compress_to_base64(""), "Q===");
        assert_eq!(compress_to_base64("abc"), "IYIwxkA=");
        assert_eq!(compress_to_base64("abcd"), "IYIwxgJkA===");
        assert_eq!(decompress_from_base64("Q===").as_deref(), Some(""));
        assert_eq!(decompress_from_base64(""), None);
    }
}
