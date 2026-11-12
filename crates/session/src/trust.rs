use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::fingerprint;

/// A phone the user has approved.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TrustedDevice {
    pub id: String,
    pub name: String,
    pub platform: String,
    /// Base64 X25519 public key.
    pub public_key: String,
    pub paired_at: u64,
    pub last_seen: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct TrustFile {
    devices: Vec<TrustedDevice>,
}

/// The explicit list of phones allowed to reconnect, persisted as JSON.
#[derive(Debug)]
pub struct TrustStore {
    path: PathBuf,
    devices: Vec<TrustedDevice>,
}

pub fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

impl TrustStore {
    pub fn load(path: &Path) -> Self {
        let devices = std::fs::read(path).ok().and_then(|b| serde_json::from_slice::<TrustFile>(&b).ok()).map(|f| f.devices).unwrap_or_default();
        TrustStore { path: path.to_path_buf(), devices }
    }

    pub fn save(&self) -> std::io::Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_vec_pretty(&TrustFile { devices: self.devices.clone() }).map_err(std::io::Error::other)?;
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, json)?;
        std::fs::rename(tmp, &self.path)
    }

    pub fn devices(&self) -> &[TrustedDevice] {
        &self.devices
    }

    pub fn find_by_key(&self, public_key: &[u8; 32]) -> Option<&TrustedDevice> {
        let b64 = STANDARD.encode(public_key);
        self.devices.iter().find(|d| d.public_key == b64)
    }

    /// Adds (or refreshes) a device and returns it.
    pub fn add(&mut self, public_key: &[u8; 32], name: &str, platform: &str) -> TrustedDevice {
        let id = fingerprint(public_key);
        let now = now_secs();
        self.devices.retain(|d| d.id != id);
        let dev = TrustedDevice { id, name: name.into(), platform: platform.into(), public_key: STANDARD.encode(public_key), paired_at: now, last_seen: now };
        self.devices.push(dev.clone());
        dev
    }

    pub fn remove(&mut self, id: &str) -> bool {
        let before = self.devices.len();
        self.devices.retain(|d| d.id != id);
        before != self.devices.len()
    }

    pub fn touch(&mut self, id: &str) {
        if let Some(d) = self.devices.iter_mut().find(|d| d.id == id) {
            d.last_seen = now_secs();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_find_remove_persist() {
        let dir = std::env::temp_dir().join(format!("vanepoint-trust-{}", rand::random::<u32>()));
        let path = dir.join("trusted.json");
        let mut s = TrustStore::load(&path);
        let key = [3u8; 32];
        let d = s.add(&key, "Pixel", "android");
        s.save().unwrap();
        let s2 = TrustStore::load(&path);
        assert_eq!(s2.find_by_key(&key).unwrap().id, d.id);
        let mut s3 = s2;
        assert!(s3.remove(&d.id));
        assert!(s3.find_by_key(&key).is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
}
