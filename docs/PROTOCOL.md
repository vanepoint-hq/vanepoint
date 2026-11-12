# Vanepoint Wire Protocol

**Version:** 0.1 · **Status:** implemented by `crates/protocol`, `crates/session` and `packages/core` (WebSocket transport). UDP and Bluetooth LE (Sections 8.2–8.3) are specified for Phase 2 and not yet implemented. Comment in [Discussions](https://github.com/vanepoint-hq/vanepoint/discussions) or open an ADR for changes.

This document specifies how Vanepoint Mobile and Vanepoint Desktop discover each other, pair, establish encrypted sessions, and exchange input over Wi-Fi (WebSocket or UDP) and Bluetooth LE. Unless stated otherwise, integers are **little-endian** and floating-point values are IEEE 754 `f32`.

The key words MUST, SHOULD, and MAY are used as described in RFC 2119.

## Contents

1. [Overview](#1-overview)
2. [Discovery](#2-discovery)
3. [Pairing](#3-pairing)
4. [Session establishment](#4-session-establishment)
5. [Framing](#5-framing)
6. [Messages](#6-messages)
7. [Reliability](#7-reliability)
8. [Transports](#8-transports)
9. [Clock synchronisation and telemetry](#9-clock-synchronisation-and-telemetry)
10. [Versioning](#10-versioning)
11. [Security considerations](#11-security-considerations)

## 1. Overview

```text
 Phone (initiator)                                   Desktop (responder)
 ─────────────────                                   ───────────────────
 mDNS browse  _vanepoint._tcp  ───────────────────────►  advertise
 Noise IK(psk1) msg 1        ───────────────────────►  verify PSK / trust
                             ◄───────────────────────  Noise msg 2
 ════════════ encrypted session (explicit-nonce AEAD frames) ════════════
 MOTION / SCROLL / DIAL …    ───────────────────────►  physics + input
                             ◄───────────────────────  HAPTIC / PROFILE
```

The phone is always the Noise **initiator**; the desktop is the **responder**.

## 2. Discovery

The desktop advertises a DNS-SD service over mDNS (RFC 6762, RFC 6763):

| Field | Value |
| --- | --- |
| Service type | `_vanepoint._tcp.local.` |
| Instance name | User-visible desktop name, e.g. `Studio MacBook` |
| Port | WebSocket port (default `47800`); UDP uses the same port number |
| TXT `v` | Highest supported protocol major version, e.g. `1` |
| TXT `fp` | First 8 bytes of `BLAKE2s(desktop_static_pubkey)`, base32, used to match a paired desktop |
| TXT `cap` | Comma-separated capabilities: `ws,udp,ble` |

The TXT record MUST NOT contain secrets. A phone that already trusts a desktop connects when the `fp` value matches a stored key. Otherwise, the phone needs to pair first.

## 3. Pairing

### 3.1 QR payload

When the user opens the pairing window, the desktop generates a fresh 128-bit `pair_secret` and shows a QR code that encodes this URI:

```text
vanepoint://pair?v=1
  &k=<base64url(desktop_static_pubkey, 32 bytes)>
  &s=<base64url(pair_secret, 16 bytes)>
  &h=<comma-separated IPv4/IPv6 addresses>
  &p=<port>
  &n=<url-encoded desktop name>
  &e=<expiry, unix seconds>
```

- `pair_secret` MUST be generated from a CSPRNG, MUST be single-use, and MUST expire after **120 seconds** at most.
- The pairing window closes after one successful pairing or on expiry.

### 3.2 Pairing handshake

The phone runs the Noise pattern **`Noise_IKpsk1_25519_ChaChaPoly_BLAKE2s`** (`-> e, es, s, ss, psk` then `<- e, ee, se`):

- `rs` (the responder's static key) is the `k` value from the QR code, so the phone authenticates the desktop it saw on screen.
- `psk = BLAKE2s(key = pair_secret, data = "vanepoint-pair-v1")`, which is 32 bytes.
- `prologue = "Vanepoint/1" || transport_kind`, where `transport_kind` is one byte: `0x01` for WebSocket, `0x02` for UDP, `0x03` for BLE.

Handshake payloads are UTF-8 JSON:

```jsonc
// message 1 payload (phone → desktop)
{ "device_name": "Pixel 9", "platform": "android", "app_version": "0.1.0",
  "protocol": [1], "capabilities": ["udp", "ble", "haptics.custom"] }

// message 2 payload (desktop → phone)
{ "accepted": true, "desktop_name": "Studio MacBook", "protocol": 1,
  "session_id": "b3c1…", "capabilities": ["udp", "ble", "overlay"] }
```

Because the PSK is mixed in at the end of message 1 (`psk1`), message 1 only decrypts if the phone knows the *current* one-time secret. The desktop therefore never shows a prompt for a phone that merely learned its public key. After message 1 decrypts, the desktop SHOULD show a confirmation such as *"Allow Pixel 9 to control this computer?"* before it sends `accepted: true`. On acceptance, both sides persist the peer's static public key, and the pairing window closes so the code cannot be reused.

## 4. Session establishment

A phone that is already paired reconnects with **`Noise_IK_25519_ChaChaPoly_BLAKE2s`**, using the same prologue and no PSK. The desktop MUST reject the handshake unless the initiator's static key is in its trust list.

After the handshake, both sides derive transport keys with Noise `Split()` and use them in **stateless (explicit-nonce) mode**, as described in Section 5. Because every frame carries its own nonce, a session can move between transports without a new handshake.

Sessions MUST rekey with a fresh handshake after 2²⁰ frames in either direction or after 10 minutes, whichever comes first.

## 5. Framing

Every frame on every transport has the same structure:

```text
 0      1                9                                   n
 ┌──────┬────────────────┬───────────────────────────────────┐
 │ kid  │ counter (u64)  │ AEAD ciphertext + 16-byte tag     │
 └──────┴────────────────┴───────────────────────────────────┘
```

| Field | Size | Description |
| --- | --- | --- |
| `kid` | 1 | Key epoch. It increments on each rekey, so frames from the previous epoch can be accepted briefly while a rekey is in progress. |
| `counter` | 8 | Strictly increasing per sender and epoch. Used as the ChaCha20-Poly1305 nonce. |
| ciphertext | n − 9 | Encrypts the plaintext message (Section 6) with ChaCha20-Poly1305. The counter is the nonce (Noise `SetNonce`), so it is authenticated; the associated data is empty. |

**Replay protection:** receivers keep a 2048-entry sliding window per epoch, in the style of RFC 6479. They MUST discard frames whose counter is already marked as seen or falls below the window.

**Overhead:** 25 bytes per frame (9-byte header plus 16-byte tag). An encrypted `MOTION` frame is therefore 41 bytes.

## 6. Messages

Each plaintext message starts with a 4-byte header:

| Offset | Field | Type | Description |
| --- | --- | --- | --- |
| 0 | `type` | u8 | Message type (table below) |
| 1 | `flags` | u8 | bit 0 `ACK_REQ`, bit 1 `IS_ACK`, bits 2–7 reserved (0) |
| 2 | `msg_id` | u16 | Per-sender message id. It wraps around, and acknowledgements refer to it. |

### 6.1 Message types

| Type | Name | Direction | Class | Body |
| --- | --- | --- | --- | --- |
| `0x01` | `MOTION` | P → D | Stream | `t_us u32 · vx f32 · vy f32` (12 B) |
| `0x02` | `SCROLL` | P → D | Stream | `t_us u32 · dx f32 · dy f32` (12 B) |
| `0x03` | `BUTTON` | P → D | Reliable | `button u8 · state u8` |
| `0x04` | `FLING` | P → D | Reliable | `t_us u32 · vx f32 · vy f32` |
| `0x05` | `DIAL` | P → D | Stream | `t_us u32 · delta_rad f32 · detents i16` |
| `0x06` | `ACTION` | P → D | Reliable | `action_id u16` (indexes the active profile) |
| `0x10` | `CONTROL` | both | Reliable | UTF-8 JSON (Section 6.3) |
| `0x11` | `HAPTIC` | D → P | Reliable | `pattern u8 · intensity u8` |
| `0x12` | `PING` | both | Stream | `t1_us u64` |
| `0x13` | `PONG` | both | Stream | `t1_us u64 · t2_us u64 · t3_us u64` |
| `0x14` | `ACK` | both | — | `acked_msg_id u16` |

- **Velocities** (`vx`, `vy`) are in *reference pixels per second*: the phone has already applied the pointer-acceleration curve, and the desktop multiplies by the display's scale factor. Positive `x` is right and positive `y` is down.
- **`button`:** 0 = left, 1 = right, 2 = middle. **`state`:** 0 = up, 1 = down.
- **`t_us`:** microseconds since session start on the sender's clock. It wraps after about 71 minutes, and receivers handle wrap-around.

### 6.2 Enumerations

| Haptic `pattern` | Meaning | | Mode id | Mode |
| --- | --- | --- | --- | --- |
| 0 | `click` | | 0 | `air` |
| 1 | `click_strong` | | 1 | `trackpad` |
| 2 | `detent` | | 2 | `present` |
| 3 | `edge` | | 3 | `trackball` |
| 4 | `connected` | | 4 | `dial` |
| 5 | `disconnected` | | 5 | `gesture` |
| 6 | `warning` | | | |
| 7 | `success` | | | |

### 6.3 CONTROL messages

`CONTROL` carries low-rate structured messages as JSON objects with an `op` field:

```jsonc
{ "op": "hello",       "protocol": 1, "capabilities": ["udp","ble"] }
{ "op": "mode",        "mode": "present" }
{ "op": "profile",     "id": "com.microsoft.Powerpoint", "layout": { /* profile layout */ } }
{ "op": "key",         "chord": ["Meta", "Shift", "KeyZ"] }
{ "op": "text",        "value": "Hello" }
{ "op": "recenter" }
{ "op": "displays",    "bounds": [[0,0,2560,1600],[2560,0,1920,1080]] }
{ "op": "laser",       "on": true, "style": "spotlight" }
{ "op": "transport",   "prefer": "ble", "reason": "client_isolation" }
{ "op": "telemetry",   "rtt_us": 4100, "loss": 0.002, "offset_us": -1520 }
{ "op": "bye",         "reason": "user" }
```

Unknown `op` values MUST be ignored, so new operations can be added without breaking older clients.

## 7. Reliability

Messages fall into two classes:

- **Stream** messages (`MOTION`, `SCROLL`, `DIAL`, `PING`, `PONG`) are never retransmitted. Newer data always replaces older data.
- **Reliable** messages set `ACK_REQ` on datagram transports (UDP, BLE write-without-response). The sender retransmits after `max(2 × srtt, 20 ms)`, for at most 5 attempts. The receiver acknowledges with `ACK` and de-duplicates by `msg_id`.

On WebSocket, TCP already guarantees delivery, so `ACK_REQ` SHOULD be cleared.

A **`BUTTON` down** whose matching **up** is lost would leave a stuck button. To prevent this, the desktop automatically releases any button that has been held for more than 2 s without a refreshing `BUTTON` message. Phones refresh held buttons every 500 ms.

## 8. Transports

### 8.1 WebSocket

- Binary messages only. Each WebSocket message carries exactly one frame.
- `TCP_NODELAY` MUST be set on both ends to disable Nagle's algorithm.
- Path `/v1/session`. No HTTP authentication is used, because authentication comes from the Noise handshake carried in the first binary messages.

### 8.2 UDP

- Same port number as WebSocket.
- One frame per datagram. Datagrams SHOULD stay under 1200 bytes.
- The phone sends a `PING` at least every 250 ms to keep NAT/AP state and the Wi-Fi radio active. This also limits the latency spikes caused by power-save mode.

### 8.3 Bluetooth LE

The phone acts as GATT **peripheral** and the desktop as **central**.

| UUID | Role | Properties |
| --- | --- | --- |
| `6a1d0001-5c3e-4b8a-9f4e-2b7d1c0a8e11` | Vanepoint service | — |
| `6a1d0002-5c3e-4b8a-9f4e-2b7d1c0a8e11` | Phone → desktop frames | Write, Write Without Response |
| `6a1d0003-5c3e-4b8a-9f4e-2b7d1c0a8e11` | Desktop → phone frames | Notify |

- An ATT MTU of at least **64** is REQUIRED, so that a `MOTION` frame (41 B) fits in one write.
- Stream messages use Write Without Response. Reliable messages use Write (acknowledged at the link layer), so `ACK_REQ` is not needed for them.
- A connection interval of 7.5–15 ms SHOULD be requested.

## 9. Clock synchronisation and telemetry

Latency telemetry uses an NTP-style exchange (Cristian's algorithm):

1. A sends `PING{t1}`.
2. B replies `PONG{t1, t2 = receive time, t3 = send time}`.
3. A records `t4` and computes:

```text
rtt    = (t4 − t1) − (t3 − t2)
offset = ((t2 − t1) + (t3 − t4)) / 2
```

The desktop keeps the offset estimate with the lowest RTT from a rolling 5-second window. Motion-to-injection latency is then `inject_time − (t_us + offset)`. Telemetry stays local unless the user exports it.

## 10. Versioning

- The **major** version appears in the prologue (`Vanepoint/1`) and in the mDNS TXT record. A different major version means peers cannot communicate.
- **Minor** features are negotiated through the `capabilities` arrays in the handshake payloads and `hello`.
- Message types `0x80`–`0xFF` are reserved for experiments and MUST be ignored by peers that do not advertise the matching capability.

## 11. Security considerations

- **Authentication** is mutual. The phone pins the desktop key from the QR code, and the desktop pins phone keys in its trust list.
- **Forward secrecy**: ephemeral keys in every handshake protect past sessions even if a static key leaks later.
- **Identity hiding**: in `IK`, the phone's static key is encrypted, so passive observers cannot link sessions to devices.
- **Replay** is prevented by explicit counters with sliding windows. Rekeying bounds counter lifetime.
- **Denial of service**: the desktop rate-limits handshake attempts (5 per 10 s per source) and does no expensive work before message 1 authenticates.
- **Profiles** can only produce `BUTTON`, `ACTION` → key chords, scroll, and pointer movement. No message type can execute commands or access files.

See also: [`SECURITY.md`](../SECURITY.md) · [ADR-0002](adr/0002-noise-protocol-for-all-transports.md)
