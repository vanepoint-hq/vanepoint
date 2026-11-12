//! Vanepoint wire protocol v1 (see `docs/PROTOCOL.md`).
//!
//! This crate is deliberately free of I/O and crypto: it defines constants, message
//! encoding, frame headers and the pairing URI, mirrored by `packages/core` in TypeScript.

mod message;
mod pairing;

pub use message::{decode, encode, ControlBody, Envelope, Message};
pub use pairing::{HandshakeReply, HandshakeRequest, PairingError, PairingInfo};

pub const PROTOCOL_VERSION: u8 = 1;
pub const DEFAULT_PORT: u16 = 47800;
pub const WS_PATH: &str = "/v1/session";

/// First byte of the first WebSocket message selects the handshake.
pub const HANDSHAKE_PAIR: u8 = 0x01;
pub const HANDSHAKE_RECONNECT: u8 = 0x02;

pub mod transport_kind {
    pub const WEBSOCKET: u8 = 0x01;
    pub const UDP: u8 = 0x02;
    pub const BLE: u8 = 0x03;
}

/// Noise prologue: `"Vanepoint/1" || transport_kind`.
pub fn prologue(transport_kind: u8) -> Vec<u8> {
    let mut p = b"Vanepoint/1".to_vec();
    p.push(transport_kind);
    p
}

/// Message type identifiers.
pub mod msg {
    pub const MOTION: u8 = 0x01;
    pub const SCROLL: u8 = 0x02;
    pub const BUTTON: u8 = 0x03;
    pub const FLING: u8 = 0x04;
    pub const DIAL: u8 = 0x05;
    pub const ACTION: u8 = 0x06;
    pub const CONTROL: u8 = 0x10;
    pub const HAPTIC: u8 = 0x11;
    pub const PING: u8 = 0x12;
    pub const PONG: u8 = 0x13;
    pub const ACK: u8 = 0x14;
}

/// WebSocket close codes sent by the desktop.
pub mod close {
    pub const PAIRING_CLOSED: u16 = 4001;
    pub const HANDSHAKE_FAILED: u16 = 4002;
    pub const NOT_TRUSTED: u16 = 4003;
    pub const DENIED: u16 = 4004;
    pub const KILLED: u16 = 4005;
    pub const REVOKED: u16 = 4006;
}

/// Haptic vocabulary (index = pattern id on the wire).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Haptic {
    Click = 0,
    ClickStrong = 1,
    Detent = 2,
    Edge = 3,
    Connected = 4,
    Disconnected = 5,
    Warning = 6,
    Success = 7,
}

/// Frame header: `kid (1) | counter (u64 LE)`, followed by the AEAD ciphertext.
pub const FRAME_HEADER_LEN: usize = 9;

/// Splits a transport frame into `(kid, counter, ciphertext)`.
pub fn split_frame(frame: &[u8]) -> Option<(u8, u64, &[u8])> {
    if frame.len() < FRAME_HEADER_LEN + 16 {
        return None;
    }
    let counter = u64::from_le_bytes(frame[1..9].try_into().ok()?);
    Some((frame[0], counter, &frame[FRAME_HEADER_LEN..]))
}

pub fn frame_header(kid: u8, counter: u64) -> [u8; FRAME_HEADER_LEN] {
    let mut h = [0u8; FRAME_HEADER_LEN];
    h[0] = kid;
    h[1..9].copy_from_slice(&counter.to_le_bytes());
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_header_round_trip() {
        let mut f = frame_header(0, 0x0102_0304_0506_0708).to_vec();
        f.extend_from_slice(&[0u8; 16]);
        let (kid, n, ct) = split_frame(&f).unwrap();
        assert_eq!((kid, n, ct.len()), (0, 0x0102_0304_0506_0708, 16));
    }

    #[test]
    fn prologue_matches_typescript() {
        assert_eq!(prologue(1), b"Vanepoint/1\x01".to_vec());
    }
}
