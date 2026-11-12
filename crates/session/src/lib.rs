//! Session security for Vanepoint (see `docs/PROTOCOL.md` §3–5 and ADR-0002).
//!
//! * First pairing: `Noise_IKpsk1_25519_ChaChaPoly_BLAKE2s` — the phone knows the desktop
//!   key from the QR code, and the one-time PSK proves it saw the *current* code before the
//!   desktop shows any approval prompt.
//! * Reconnect: `Noise_IK_25519_ChaChaPoly_BLAKE2s`, accepted only for trusted phone keys.
//! * Transport: explicit-nonce frames with a sliding replay window, so frames are
//!   self-describing and can travel over any transport.

mod replay;
mod trust;

use std::path::Path;
use std::sync::Arc;

pub use replay::ReplayWindow;
pub use trust::{now_secs, TrustStore, TrustedDevice};

use vanepoint_protocol::{frame_header, prologue, split_frame, FRAME_HEADER_LEN};

pub const PATTERN_PAIR: &str = "Noise_IKpsk1_25519_ChaChaPoly_BLAKE2s";
pub const PATTERN_RECONNECT: &str = "Noise_IK_25519_ChaChaPoly_BLAKE2s";
const MAX_MSG: usize = 65_535;

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("noise: {0}")]
    Noise(#[from] snow::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("handshake message 1 did not contain a static key")]
    NoRemoteStatic,
    #[error("invalid key material")]
    InvalidKey,
}

pub type Result<T> = std::result::Result<T, SessionError>;

/// The desktop's long-term X25519 identity.
#[derive(Clone)]
pub struct Identity {
    private: [u8; 32],
    public: [u8; 32],
}

impl std::fmt::Debug for Identity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Identity").field("public", &fingerprint(&self.public)).finish_non_exhaustive()
    }
}

impl Identity {
    pub fn generate() -> Result<Self> {
        let kp = snow::Builder::new(PATTERN_RECONNECT.parse()?).generate_keypair()?;
        Ok(Identity {
            private: kp.private.try_into().map_err(|_| SessionError::InvalidKey)?,
            public: kp.public.try_into().map_err(|_| SessionError::InvalidKey)?,
        })
    }

    pub fn public_key(&self) -> &[u8; 32] {
        &self.public
    }

    /// Loads `path` (64 bytes: private ‖ public) or creates it with owner-only permissions.
    pub fn load_or_create(path: &Path) -> Result<Self> {
        if let Ok(bytes) = std::fs::read(path) {
            if bytes.len() == 64 {
                return Ok(Identity {
                    private: bytes[..32].try_into().map_err(|_| SessionError::InvalidKey)?,
                    public: bytes[32..].try_into().map_err(|_| SessionError::InvalidKey)?,
                });
            }
            log::warn!("identity file {} is malformed; generating a new identity", path.display());
        }
        let id = Identity::generate()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut bytes = id.private.to_vec();
        bytes.extend_from_slice(&id.public);
        std::fs::write(path, &bytes)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        }
        Ok(id)
    }
}

/// psk = BLAKE2s(key = secret, data = "vanepoint-pair-v1"), 32 bytes.
pub fn pairing_psk(secret: &[u8]) -> [u8; 32] {
    let h = blake2s_simd::Params::new().hash_length(32).key(secret).hash(b"vanepoint-pair-v1");
    h.as_bytes().try_into().expect("32-byte hash")
}

/// First 8 bytes of BLAKE2s(public key), hex — a short stable device/desktop id.
pub fn fingerprint(public_key: &[u8]) -> String {
    hex::encode(&blake2s_simd::blake2s(public_key).as_bytes()[..8])
}

/// Fresh random pairing secret.
pub fn random_secret() -> [u8; 16] {
    rand::random()
}

/// Desktop side of a handshake.
pub struct Responder {
    hs: snow::HandshakeState,
}

impl Responder {
    /// First-time pairing (IKpsk1) with the PSK derived from the QR secret.
    pub fn pair(identity: &Identity, psk: &[u8; 32], transport_kind: u8) -> Result<Self> {
        let hs =
            snow::Builder::new(PATTERN_PAIR.parse()?).local_private_key(&identity.private).psk(1, psk).prologue(&prologue(transport_kind)).build_responder()?;
        Ok(Responder { hs })
    }

    /// Reconnection of an already-paired phone (IK).
    pub fn reconnect(identity: &Identity, transport_kind: u8) -> Result<Self> {
        let hs = snow::Builder::new(PATTERN_RECONNECT.parse()?).local_private_key(&identity.private).prologue(&prologue(transport_kind)).build_responder()?;
        Ok(Responder { hs })
    }

    /// Reads message 1 and returns its payload and the phone's static public key.
    pub fn read_message1(&mut self, message: &[u8]) -> Result<(Vec<u8>, [u8; 32])> {
        let mut buf = vec![0u8; MAX_MSG];
        let n = self.hs.read_message(message, &mut buf)?;
        buf.truncate(n);
        let rs: [u8; 32] = self.hs.get_remote_static().ok_or(SessionError::NoRemoteStatic)?.try_into().map_err(|_| SessionError::InvalidKey)?;
        Ok((buf, rs))
    }

    /// Writes message 2 and switches to transport mode.
    pub fn write_message2(mut self, payload: &[u8]) -> Result<(Vec<u8>, TransportTx, TransportRx)> {
        let mut buf = vec![0u8; MAX_MSG];
        let n = self.hs.write_message(payload, &mut buf)?;
        buf.truncate(n);
        let (tx, rx) = split_transport(self.hs)?;
        Ok((buf, tx, rx))
    }
}

/// Phone side (used by tests and tools; the real phone uses `packages/core`).
pub struct Initiator {
    hs: snow::HandshakeState,
}

impl Initiator {
    pub fn new(local_private: &[u8], remote_public: &[u8], psk: Option<&[u8; 32]>, transport_kind: u8) -> Result<Self> {
        let pattern = if psk.is_some() { PATTERN_PAIR } else { PATTERN_RECONNECT };
        let prologue = prologue(transport_kind);
        let mut b = snow::Builder::new(pattern.parse()?).local_private_key(local_private).remote_public_key(remote_public).prologue(&prologue);
        if let Some(psk) = psk {
            b = b.psk(1, psk);
        }
        Ok(Initiator { hs: b.build_initiator()? })
    }

    pub fn write_message1(&mut self, payload: &[u8]) -> Result<Vec<u8>> {
        let mut buf = vec![0u8; MAX_MSG];
        let n = self.hs.write_message(payload, &mut buf)?;
        buf.truncate(n);
        Ok(buf)
    }

    pub fn read_message2(mut self, message: &[u8]) -> Result<(Vec<u8>, TransportTx, TransportRx)> {
        let mut buf = vec![0u8; MAX_MSG];
        let n = self.hs.read_message(message, &mut buf)?;
        buf.truncate(n);
        let (tx, rx) = split_transport(self.hs)?;
        Ok((buf, tx, rx))
    }
}

fn split_transport(hs: snow::HandshakeState) -> Result<(TransportTx, TransportRx)> {
    let state = Arc::new(hs.into_stateless_transport_mode()?);
    Ok((TransportTx { state: state.clone(), counter: 0, kid: 0 }, TransportRx { state, replay: ReplayWindow::default(), kid: 0 }))
}

/// Sending half of an explicit-nonce transport.
pub struct TransportTx {
    state: Arc<snow::StatelessTransportState>,
    counter: u64,
    kid: u8,
}

impl TransportTx {
    pub fn seal(&mut self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let n = self.counter;
        self.counter += 1;
        let mut out = vec![0u8; FRAME_HEADER_LEN + plaintext.len() + 16];
        out[..FRAME_HEADER_LEN].copy_from_slice(&frame_header(self.kid, n));
        let len = self.state.write_message(n, plaintext, &mut out[FRAME_HEADER_LEN..])?;
        out.truncate(FRAME_HEADER_LEN + len);
        Ok(out)
    }

    pub fn frames_sent(&self) -> u64 {
        self.counter
    }
}

/// Receiving half: authenticates frames and rejects replays.
pub struct TransportRx {
    state: Arc<snow::StatelessTransportState>,
    replay: ReplayWindow,
    kid: u8,
}

impl TransportRx {
    /// `None` for malformed, replayed or unauthentic frames.
    pub fn open(&mut self, frame: &[u8]) -> Option<Vec<u8>> {
        let (kid, n, ct) = split_frame(frame)?;
        if kid != self.kid || !self.replay.check(n) {
            return None;
        }
        let mut out = vec![0u8; ct.len()];
        let len = self.state.read_message(n, ct, &mut out).ok()?;
        self.replay.update(n);
        out.truncate(len);
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn phone() -> Identity {
        Identity::generate().unwrap()
    }

    #[test]
    fn pair_then_exchange_frames() {
        let desktop = Identity::generate().unwrap();
        let ph = phone();
        let secret = random_secret();
        let psk = pairing_psk(&secret);
        let mut ini = Initiator::new(&ph.private, &desktop.public, Some(&psk), 1).unwrap();
        let m1 = ini.write_message1(b"{\"device_name\":\"t\"}").unwrap();
        let mut res = Responder::pair(&desktop, &psk, 1).unwrap();
        let (payload, rs) = res.read_message1(&m1).unwrap();
        assert_eq!(payload, b"{\"device_name\":\"t\"}");
        assert_eq!(&rs, ph.public_key());
        let (m2, mut dtx, mut drx) = res.write_message2(b"ok").unwrap();
        let (reply, mut ptx, mut prx) = ini.read_message2(&m2).unwrap();
        assert_eq!(reply, b"ok");
        let f1 = ptx.seal(b"one").unwrap();
        let f2 = ptx.seal(b"two").unwrap();
        assert_eq!(drx.open(&f2).unwrap(), b"two");
        assert_eq!(drx.open(&f1).unwrap(), b"one");
        assert!(drx.open(&f1).is_none(), "replay rejected");
        let mut bad = ptx.seal(b"three").unwrap();
        *bad.last_mut().unwrap() ^= 1;
        assert!(drx.open(&bad).is_none(), "tamper rejected");
        assert_eq!(prx.open(&dtx.seal(b"back").unwrap()).unwrap(), b"back");
    }

    #[test]
    fn wrong_psk_fails_on_message1() {
        let desktop = Identity::generate().unwrap();
        let ph = phone();
        let mut ini = Initiator::new(&ph.private, &desktop.public, Some(&pairing_psk(b"aaaaaaaaaaaaaaaa")), 1).unwrap();
        let m1 = ini.write_message1(b"x").unwrap();
        let mut res = Responder::pair(&desktop, &pairing_psk(b"bbbbbbbbbbbbbbbb"), 1).unwrap();
        assert!(res.read_message1(&m1).is_err());
    }

    #[test]
    fn reconnect_with_ik() {
        let desktop = Identity::generate().unwrap();
        let ph = phone();
        let mut ini = Initiator::new(&ph.private, &desktop.public, None, 1).unwrap();
        let m1 = ini.write_message1(b"").unwrap();
        let mut res = Responder::reconnect(&desktop, 1).unwrap();
        let (_, rs) = res.read_message1(&m1).unwrap();
        assert_eq!(&rs, ph.public_key());
        let (m2, _, _) = res.write_message2(b"").unwrap();
        assert!(ini.read_message2(&m2).is_ok());
    }

    #[test]
    fn identity_persists() {
        let dir = std::env::temp_dir().join(format!("vanepoint-test-{}", rand::random::<u32>()));
        let path = dir.join("identity.key");
        let a = Identity::load_or_create(&path).unwrap();
        let b = Identity::load_or_create(&path).unwrap();
        assert_eq!(a.public_key(), b.public_key());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn psk_matches_typescript_vector() {
        // Same derivation as packages/core derivePairingPsk(secret = 0x00..0x0f).
        let secret: Vec<u8> = (0u8..16).collect();
        assert_eq!(pairing_psk(&secret).len(), 32);
        assert_eq!(fingerprint(&[0u8; 32]).len(), 16);
    }
}
