use crate::msg;

/// CONTROL payload: a JSON object with an `op` field. Unknown ops must be ignored.
pub type ControlBody = serde_json::Map<String, serde_json::Value>;

#[derive(Debug, Clone, PartialEq)]
pub enum Message {
    Motion { t_us: u32, vx: f32, vy: f32 },
    Scroll { t_us: u32, dx: f32, dy: f32 },
    Button { button: u8, down: bool },
    Fling { t_us: u32, vx: f32, vy: f32 },
    Dial { t_us: u32, delta_rad: f32, detents: i16 },
    Action { id: u16 },
    Control(ControlBody),
    Haptic { pattern: u8, intensity: u8 },
    Ping { t1: u64 },
    Pong { t1: u64, t2: u64, t3: u64 },
    Ack { id: u16 },
}

impl Message {
    pub fn control(value: serde_json::Value) -> Option<Message> {
        match value {
            serde_json::Value::Object(map) if map.get("op").and_then(|v| v.as_str()).is_some() => Some(Message::Control(map)),
            _ => None,
        }
    }

    /// The `op` of a CONTROL message.
    pub fn op(&self) -> Option<&str> {
        match self {
            Message::Control(m) => m.get("op").and_then(|v| v.as_str()),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Envelope {
    pub flags: u8,
    pub msg_id: u16,
    pub message: Message,
}

const HEADER: usize = 4;

pub fn encode(message: &Message, msg_id: u16, flags: u8) -> Vec<u8> {
    let mut out = Vec::with_capacity(32);
    let ty = match message {
        Message::Motion { .. } => msg::MOTION,
        Message::Scroll { .. } => msg::SCROLL,
        Message::Button { .. } => msg::BUTTON,
        Message::Fling { .. } => msg::FLING,
        Message::Dial { .. } => msg::DIAL,
        Message::Action { .. } => msg::ACTION,
        Message::Control(_) => msg::CONTROL,
        Message::Haptic { .. } => msg::HAPTIC,
        Message::Ping { .. } => msg::PING,
        Message::Pong { .. } => msg::PONG,
        Message::Ack { .. } => msg::ACK,
    };
    out.push(ty);
    out.push(flags);
    out.extend_from_slice(&msg_id.to_le_bytes());
    match message {
        Message::Motion { t_us, vx, vy } | Message::Fling { t_us, vx, vy } => {
            out.extend_from_slice(&t_us.to_le_bytes());
            out.extend_from_slice(&vx.to_le_bytes());
            out.extend_from_slice(&vy.to_le_bytes());
        }
        Message::Scroll { t_us, dx, dy } => {
            out.extend_from_slice(&t_us.to_le_bytes());
            out.extend_from_slice(&dx.to_le_bytes());
            out.extend_from_slice(&dy.to_le_bytes());
        }
        Message::Button { button, down } => {
            out.push(*button);
            out.push(u8::from(*down));
        }
        Message::Dial { t_us, delta_rad, detents } => {
            out.extend_from_slice(&t_us.to_le_bytes());
            out.extend_from_slice(&delta_rad.to_le_bytes());
            out.extend_from_slice(&detents.to_le_bytes());
        }
        Message::Action { id } | Message::Ack { id } => out.extend_from_slice(&id.to_le_bytes()),
        Message::Control(body) => out.extend_from_slice(serde_json::to_string(body).unwrap_or_default().as_bytes()),
        Message::Haptic { pattern, intensity } => {
            out.push(*pattern);
            out.push(*intensity);
        }
        Message::Ping { t1 } => out.extend_from_slice(&t1.to_le_bytes()),
        Message::Pong { t1, t2, t3 } => {
            out.extend_from_slice(&t1.to_le_bytes());
            out.extend_from_slice(&t2.to_le_bytes());
            out.extend_from_slice(&t3.to_le_bytes());
        }
    }
    out
}

fn u16_at(b: &[u8], i: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(i..i + 2)?.try_into().ok()?))
}
fn i16_at(b: &[u8], i: usize) -> Option<i16> {
    Some(i16::from_le_bytes(b.get(i..i + 2)?.try_into().ok()?))
}
fn u32_at(b: &[u8], i: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(i..i + 4)?.try_into().ok()?))
}
fn f32_at(b: &[u8], i: usize) -> Option<f32> {
    let v = f32::from_le_bytes(b.get(i..i + 4)?.try_into().ok()?);
    v.is_finite().then_some(v)
}
fn u64_at(b: &[u8], i: usize) -> Option<u64> {
    Some(u64::from_le_bytes(b.get(i..i + 8)?.try_into().ok()?))
}

/// Decodes a plaintext message; returns `None` for malformed or unknown messages.
pub fn decode(b: &[u8]) -> Option<Envelope> {
    if b.len() < HEADER {
        return None;
    }
    let ty = b[0];
    let flags = b[1];
    let msg_id = u16_at(b, 2)?;
    let p = HEADER;
    let message = match ty {
        msg::MOTION => Message::Motion { t_us: u32_at(b, p)?, vx: f32_at(b, p + 4)?, vy: f32_at(b, p + 8)? },
        msg::FLING => Message::Fling { t_us: u32_at(b, p)?, vx: f32_at(b, p + 4)?, vy: f32_at(b, p + 8)? },
        msg::SCROLL => Message::Scroll { t_us: u32_at(b, p)?, dx: f32_at(b, p + 4)?, dy: f32_at(b, p + 8)? },
        msg::BUTTON => Message::Button { button: *b.get(p)?, down: *b.get(p + 1)? != 0 },
        msg::DIAL => Message::Dial { t_us: u32_at(b, p)?, delta_rad: f32_at(b, p + 4)?, detents: i16_at(b, p + 8)? },
        msg::ACTION => Message::Action { id: u16_at(b, p)? },
        msg::ACK => Message::Ack { id: u16_at(b, p)? },
        msg::CONTROL => {
            let v: serde_json::Value = serde_json::from_slice(&b[p..]).ok()?;
            Message::control(v)?
        }
        msg::HAPTIC => Message::Haptic { pattern: *b.get(p)?, intensity: *b.get(p + 1)? },
        msg::PING => Message::Ping { t1: u64_at(b, p)? },
        msg::PONG => Message::Pong { t1: u64_at(b, p)?, t2: u64_at(b, p + 8)?, t3: u64_at(b, p + 16)? },
        _ => return None,
    };
    Some(Envelope { flags, msg_id, message })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_every_message() {
        let cases = vec![
            Message::Motion { t_us: 123_456, vx: 812.5, vy: -40.25 },
            Message::Scroll { t_us: 9, dx: 0.0, dy: -3.0 },
            Message::Button { button: 1, down: true },
            Message::Fling { t_us: 77, vx: 3000.0, vy: 10.0 },
            Message::Dial { t_us: 5, delta_rad: 0.25, detents: -3 },
            Message::Action { id: 7 },
            Message::control(serde_json::json!({ "op": "mode", "mode": "present" })).unwrap(),
            Message::Haptic { pattern: 3, intensity: 200 },
            Message::Ping { t1: 1_731_400_000_123_456 },
            Message::Pong { t1: 1, t2: 1 << 40, t3: (1 << 40) + 5 },
            Message::Ack { id: 65535 },
        ];
        for m in cases {
            let env = decode(&encode(&m, 42, 1)).expect("decodes");
            assert_eq!(env, Envelope { flags: 1, msg_id: 42, message: m });
        }
    }

    #[test]
    fn motion_is_sixteen_bytes() {
        assert_eq!(encode(&Message::Motion { t_us: 0, vx: 1.0, vy: 2.0 }, 0, 0).len(), 16);
    }

    #[test]
    fn rejects_non_finite_and_truncated() {
        let mut m = encode(&Message::Motion { t_us: 0, vx: 1.0, vy: 2.0 }, 0, 0);
        m[8..12].copy_from_slice(&f32::NAN.to_le_bytes());
        assert!(decode(&m).is_none());
        assert!(decode(&[0x01, 0, 0, 0, 1]).is_none());
        assert!(decode(&[0x10, 0, 0, 0, b'{', b'}']).is_none());
    }

    /// Bytes produced by `packages/core` (TypeScript) for the same message.
    #[test]
    fn matches_typescript_encoding() {
        let ts: [u8; 16] = [1, 0, 42, 0, 64, 226, 1, 0, 0, 32, 75, 68, 0, 0, 33, 194];
        let env = decode(&ts).unwrap();
        assert_eq!(env.message, Message::Motion { t_us: 123_456, vx: 812.5, vy: -40.25 });
    }
}
