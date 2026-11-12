use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};

const SCHEME: &str = "vanepoint://pair";

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum PairingError {
    #[error("not a Vanepoint pairing code")]
    NotPairingUri,
    #[error("pairing code is missing `{0}`")]
    Missing(&'static str),
    #[error("pairing code field `{0}` is invalid")]
    Invalid(&'static str),
}

/// Contents of the pairing QR code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairingInfo {
    pub version: u8,
    pub desktop_key: [u8; 32],
    pub secret: [u8; 16],
    pub hosts: Vec<String>,
    pub port: u16,
    pub name: String,
    /// Unix seconds.
    pub expires_at: u64,
}

/// Percent-encoding compatible with JavaScript's `encodeURIComponent`.
fn encode_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn decode_component(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

impl PairingInfo {
    pub fn to_uri(&self) -> String {
        format!(
            "{SCHEME}?v={}&k={}&s={}&h={}&p={}&n={}&e={}",
            self.version,
            URL_SAFE_NO_PAD.encode(self.desktop_key),
            URL_SAFE_NO_PAD.encode(self.secret),
            self.hosts.iter().map(|h| encode_component(h)).collect::<Vec<_>>().join(","),
            self.port,
            encode_component(&self.name),
            self.expires_at
        )
    }

    pub fn parse(uri: &str) -> Result<Self, PairingError> {
        let uri = uri.trim();
        if !uri.to_ascii_lowercase().starts_with(SCHEME) {
            return Err(PairingError::NotPairingUri);
        }
        let query = uri.split_once('?').map(|(_, q)| q).ok_or(PairingError::NotPairingUri)?;
        let get = |key: &'static str| -> Result<&str, PairingError> {
            query
                .split('&')
                .filter_map(|kv| kv.split_once('='))
                .find(|(k, _)| *k == key)
                .map(|(_, v)| v)
                .filter(|v| !v.is_empty())
                .ok_or(PairingError::Missing(key))
        };
        let key: [u8; 32] = URL_SAFE_NO_PAD.decode(get("k")?).ok().and_then(|v| v.try_into().ok()).ok_or(PairingError::Invalid("k"))?;
        let secret: [u8; 16] = URL_SAFE_NO_PAD.decode(get("s")?).ok().and_then(|v| v.try_into().ok()).ok_or(PairingError::Invalid("s"))?;
        let version: u8 = get("v")?.parse().map_err(|_| PairingError::Invalid("v"))?;
        if version != 1 {
            return Err(PairingError::Invalid("v"));
        }
        Ok(PairingInfo {
            version,
            desktop_key: key,
            secret,
            hosts: get("h")?.split(',').filter_map(decode_component).filter(|h| !h.is_empty()).collect(),
            port: get("p")?.parse().map_err(|_| PairingError::Invalid("p"))?,
            name: get("n").ok().and_then(decode_component).unwrap_or_else(|| "Desktop".into()),
            expires_at: get("e")?.parse().map_err(|_| PairingError::Invalid("e"))?,
        })
    }
}

/// Payload of handshake message 1 (phone → desktop).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HandshakeRequest {
    #[serde(default = "unknown")]
    pub device_name: String,
    #[serde(default = "unknown")]
    pub platform: String,
    #[serde(default)]
    pub app_version: String,
    #[serde(default)]
    pub protocol: Vec<u8>,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

fn unknown() -> String {
    "Unknown device".into()
}

impl HandshakeRequest {
    /// Clamp user-controlled strings before showing them in the UI.
    pub fn sanitized(mut self) -> Self {
        let clean = |s: &str, max: usize| -> String { s.chars().filter(|c| !c.is_control()).take(max).collect::<String>().trim().to_string() };
        self.device_name = clean(&self.device_name, 48);
        if self.device_name.is_empty() {
            self.device_name = unknown();
        }
        self.platform = clean(&self.platform, 16);
        self.app_version = clean(&self.app_version, 24);
        self.capabilities.truncate(16);
        self
    }
}

/// Payload of handshake message 2 (desktop → phone).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HandshakeReply {
    pub accepted: bool,
    pub desktop_name: String,
    pub protocol: u8,
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> PairingInfo {
        PairingInfo {
            version: 1,
            desktop_key: [7u8; 32],
            secret: [9u8; 16],
            hosts: vec!["192.168.1.20".into(), "10.0.0.5".into()],
            port: 47800,
            name: "Studio PC & Co".into(),
            expires_at: 1_900_000_000,
        }
    }

    #[test]
    fn uri_round_trip() {
        let p = sample();
        assert_eq!(PairingInfo::parse(&p.to_uri()).unwrap(), p);
    }

    #[test]
    fn rejects_bad_uris() {
        assert_eq!(PairingInfo::parse("https://x"), Err(PairingError::NotPairingUri));
        assert!(PairingInfo::parse("vanepoint://pair?v=1&k=abc").is_err());
    }

    #[test]
    fn sanitizes_device_names() {
        let r = HandshakeRequest {
            device_name: "Evil\u{7}\nName that is far too long to ever fit in the user interface panel".into(),
            platform: "ios".into(),
            app_version: "0.1".into(),
            protocol: vec![1],
            capabilities: vec![],
        }
        .sanitized();
        assert!(!r.device_name.contains('\n'));
        assert!(r.device_name.chars().count() <= 48);
    }
}
